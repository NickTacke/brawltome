import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from '@brawltome/foundation'
import { replayKey, timelineKey } from './keys'
import { LEASE_SECONDS, MAX_ATTEMPTS } from './limits'
import { candidateKey, type PlayedLine, parseReplayLine, UnknownFormatError } from './line'
import { cleanupIfDue, noteWorkerReport } from './maintenance'
import type { ReplaysDeps } from './model'
import { owningUploads, rejectWaitingUploads, settleUploads, waitingUploads } from './ownership'

// the worker on VM 106 claims a job, plays the replay with bh-native, and answers with the line or a failure.
// every answer is fenced by the lease, so a worker that lost its lease can't overwrite a newer attempt

export type WorkerReport = { build: string; patches: string[] }

export type ClaimedJob = {
  jobId: string
  leaseToken: string
  kind: 'parse' | 'reparse'
  digest: string
  replayBytes: Uint8Array
}

export type JobFailureCode =
  | 'game-error'
  | 'unreadable'
  | 'never-ended'
  | 'patch-not-supported'
  | 'unknown-format'
  | 'not-your-match'
  | 'worker-error'

export type CompleteOutcome = 'completed' | 'failed' | 'lease-lost' | 'not-found'

type LiveJob = { id: string; digest: string; build: string; attempts: number }

// bh-native's exit codes for a replay it couldn't play
const exitFailures: Record<number, JobFailureCode> = {
  1: 'game-error',
  2: 'unreadable',
  3: 'patch-not-supported',
  4: 'never-ended',
}

/** The next job for the worker, oldest parse first, then re-parses; null when there is nothing to do. */
export async function claimJob(deps: ReplaysDeps, report: WorkerReport): Promise<ClaimedJob | null> {
  await noteWorkerReport(deps.database.sql, report)
  await cleanupIfDue(deps, new Date())
  await failExhaustedJobs(deps.database.sql)

  for (;;) {
    const job = await takeNextJob(deps.database.sql, report.build)

    if (!job) return null

    const replayBytes = await deps.objectStore.get(replayKey(job.digest))

    if (replayBytes) return { ...job, replayBytes }

    // the file is gone (expired with its patch), so this job can never run
    await finishWithFailure(
      deps.database.sql,
      { id: job.jobId, digest: job.digest },
      'unreadable',
      'the replay file is no longer stored',
      true,
    )
  }
}

async function failExhaustedJobs(sql: Sql): Promise<void> {
  const exhausted = await sql<{ digest: string }[]>`
    UPDATE replays.jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp(),
      failure = ${JSON.stringify({ code: 'worker-error', message: `no answer after ${MAX_ATTEMPTS} attempts` })}::text::jsonb
    WHERE status = 'processing' AND lease_expires_at <= clock_timestamp() AND attempts >= ${MAX_ATTEMPTS}
    RETURNING digest
  `

  for (const { digest } of exhausted) await rejectWaitingUploads(sql, digest, 'worker-error')
}

async function takeNextJob(sql: Sql, build: string): Promise<Omit<ClaimedJob, 'replayBytes'> | null> {
  const [job] = await sql<Omit<ClaimedJob, 'replayBytes'>[]>`
    WITH candidate AS (
      SELECT id FROM replays.jobs
      WHERE status = 'pending'
        OR (status = 'processing' AND lease_expires_at <= clock_timestamp() AND attempts < ${MAX_ATTEMPTS})
      ORDER BY kind = 'parse' DESC, created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE replays.jobs AS job SET status = 'processing', attempts = job.attempts + 1, build = ${build},
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
      updated_at = clock_timestamp()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id AS "jobId", job.lease_token AS "leaseToken", job.kind, job.digest
  `

  return job ?? null
}

/** Stores the match a line describes; a line for a replay that didn't play becomes the job's failure. */
export async function completeJob(
  deps: ReplaysDeps,
  input: { jobId: string; leaseToken: string; line: string },
): Promise<CompleteOutcome> {
  const job = await findLiveJob(deps.database.sql, input.jobId, input.leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return job

  const parsed = readLine(input.line)

  if ('failure' in parsed) {
    await finishWithFailure(deps.database.sql, job, parsed.failure, parsed.message, true)

    return 'failed'
  }

  return storeMatch(deps, job, input.leaseToken, parsed.line, input.line)
}

function readLine(text: string): { line: PlayedLine } | { failure: JobFailureCode; message: string } {
  try {
    const line = parseReplayLine(text)

    if (line.played) return { line }

    return { failure: exitFailures[line.exit] ?? 'game-error', message: `bh-native exit ${line.exit}` }
  } catch (error) {
    const message = error instanceof UnknownFormatError ? error.message : `the line doesn't parse: ${String(error)}`

    return { failure: 'unknown-format', message: message.slice(0, 500) }
  }
}

async function storeMatch(
  deps: ReplaysDeps,
  job: LiveJob,
  leaseToken: string,
  line: PlayedLine,
  rawLine: string,
): Promise<CompleteOutcome> {
  const sql = deps.database.sql
  const uploads = await waitingUploads(sql, job.digest)

  const owners = await owningUploads(
    deps,
    uploads,
    line.players.map((player) => player.brawlhallaId),
  )

  const [existing] = await sql<{ id: string; timelineKey: string | null }[]>`
    SELECT id, timeline_key AS "timelineKey" FROM replays.matches WHERE digest = ${job.digest}
  `

  if (!existing && owners.size === 0) {
    await finishWithFailure(sql, job, 'not-your-match', 'no uploader played in this match', true)
    await deleteReplayFile(deps, job.digest)

    return 'failed'
  }

  const matchId = existing?.id ?? randomUUID()
  const key = timelineKey(matchId, job.build)

  await deps.objectStore.put(key, Bun.gzipSync(new TextEncoder().encode(rawLine)), 'application/gzip')

  const stored = await sql.begin(async (transaction) => {
    const [locked] = await transaction<{ ok: boolean }[]>`
      SELECT (status = 'processing' AND lease_token = ${leaseToken} AND lease_expires_at > clock_timestamp()) AS ok
      FROM replays.jobs WHERE id = ${job.id} FOR UPDATE
    `

    if (!locked?.ok) return false

    await writeMatch(transaction, matchId, job, line)
    await settleUploads(transaction, uploads, owners, matchId)
    await transaction`UPDATE replays.replay_files SET patch = ${line.patch} WHERE digest = ${job.digest}`

    await transaction`
      UPDATE replays.jobs SET status = 'completed', lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE id = ${job.id}
    `

    return true
  })

  if (!stored) {
    if (existing?.timelineKey !== key) await deps.objectStore.delete(key)

    return 'lease-lost'
  }

  if (existing?.timelineKey && existing.timelineKey !== key) await deps.objectStore.delete(existing.timelineKey)

  return 'completed'
}

async function writeMatch(transaction: TransactionSql, matchId: string, job: LiveJob, line: PlayedLine): Promise<void> {
  const match = line.match
  const reliability = line.reliability
  const key = timelineKey(matchId, job.build)

  await transaction`
    INSERT INTO replays.matches (id, digest, candidate_key, patch, format, build, map_id, map_name, mode_name, queue,
      is_ranked, is_custom, has_teams, has_team_damage, stocks, duration_ms, is_reliable, failed_checks, unchecked,
      timeline_key)
    VALUES (${matchId}, ${job.digest}, ${candidateKey(line)}, ${line.patch}, ${line.format}, ${job.build},
      ${match.mapId}, ${match.mapName}, ${match.modeName}, ${match.queue}, ${match.isRanked}, ${match.isCustom},
      ${match.hasTeams}, ${match.hasTeamDamage}, ${match.stocks}, ${match.durationMs}, ${reliability.isReliable},
      ${JSON.stringify(reliability.failedChecks)}::text::jsonb, ${JSON.stringify(reliability.unchecked)}::text::jsonb, ${key})
    ON CONFLICT (digest) DO UPDATE SET candidate_key = excluded.candidate_key, patch = excluded.patch,
      format = excluded.format, build = excluded.build, map_id = excluded.map_id, map_name = excluded.map_name,
      mode_name = excluded.mode_name, queue = excluded.queue, is_ranked = excluded.is_ranked,
      is_custom = excluded.is_custom, has_teams = excluded.has_teams, has_team_damage = excluded.has_team_damage,
      stocks = excluded.stocks, duration_ms = excluded.duration_ms, is_reliable = excluded.is_reliable,
      failed_checks = excluded.failed_checks, unchecked = excluded.unchecked, timeline_key = excluded.timeline_key,
      parsed_at = clock_timestamp()
  `

  await transaction`DELETE FROM replays.match_players WHERE match_id = ${matchId}`

  for (const player of line.players) {
    await transaction`
      INSERT INTO replays.match_players (match_id, slot, brawlhalla_id, name, team, legend_id, legend_name,
        damage_dealt, damage_taken, kos, deaths, suicides, team_kos, clashes, dodges, air_dodges, jumps, air_jumps,
        dashes, dash_jumps, time_in_air_ms, time_on_ground_ms, time_on_wall_ms, score, weapons)
      VALUES (${matchId}, ${player.slot}, ${player.brawlhallaId}, ${player.name.slice(0, 64)}, ${player.team},
        ${player.legendId}, ${player.legendName.slice(0, 64)}, ${player.damageDealt}, ${player.damageTaken},
        ${player.kos}, ${player.deaths}, ${player.suicides}, ${player.teamKos}, ${player.clashes}, ${player.dodges},
        ${player.airDodges}, ${player.jumps}, ${player.airJumps}, ${player.dashes}, ${player.dashJumps},
        ${player.timeInAirMs}, ${player.timeOnGroundMs}, ${player.timeOnWallMs}, ${player.score},
        ${JSON.stringify(player.weapons)}::text::jsonb)
    `
  }
}

async function deleteReplayFile(deps: ReplaysDeps, digest: string): Promise<void> {
  await deps.objectStore.delete(replayKey(digest))
  await deps.database.sql`UPDATE replays.replay_files SET deleted_at = clock_timestamp() WHERE digest = ${digest}`
}

async function findLiveJob(sql: Sql, jobId: string, leaseToken: string): Promise<LiveJob | 'not-found' | 'lease-lost'> {
  const [job] = await sql<(LiveJob & { live: boolean })[]>`
    SELECT id, digest, build, attempts,
      (status = 'processing' AND lease_token = ${leaseToken} AND lease_expires_at > clock_timestamp()) AS live
    FROM replays.jobs WHERE id = ${jobId}
  `

  if (!job) return 'not-found'

  if (!job.live) return 'lease-lost'

  return job
}

/** Records the worker's failure; only worker-error is retried, and only while attempts are left. */
export async function failJob(
  deps: ReplaysDeps,
  input: { jobId: string; leaseToken: string; code: JobFailureCode; message: string },
): Promise<boolean> {
  const job = await findLiveJob(deps.database.sql, input.jobId, input.leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return false

  const isFinal = input.code !== 'worker-error' || job.attempts >= MAX_ATTEMPTS

  await finishWithFailure(deps.database.sql, job, input.code, input.message.slice(0, 500), isFinal)

  return true
}

async function finishWithFailure(
  sql: Sql,
  job: Pick<LiveJob, 'id' | 'digest'>,
  code: JobFailureCode,
  message: string,
  isFinal: boolean,
): Promise<void> {
  if (!isFinal) {
    await sql`
      UPDATE replays.jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE id = ${job.id}
    `

    return
  }

  await sql`
    UPDATE replays.jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp(),
      failure = ${JSON.stringify({ code, message })}::text::jsonb
    WHERE id = ${job.id}
  `

  await rejectWaitingUploads(sql, job.digest, code)
}

export async function renewLease(deps: ReplaysDeps, jobId: string, leaseToken: string): Promise<boolean> {
  const renewed = await deps.database.sql`
    UPDATE replays.jobs SET lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
      updated_at = clock_timestamp()
    WHERE id = ${jobId} AND status = 'processing' AND lease_token = ${leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  return renewed.count === 1
}

/** Gives a job back unplayed, for a worker shutting down; it doesn't count as an attempt. */
export async function releaseJob(deps: ReplaysDeps, jobId: string, leaseToken: string): Promise<boolean> {
  const released = await deps.database.sql`
    UPDATE replays.jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
      attempts = greatest(attempts - 1, 0), updated_at = clock_timestamp()
    WHERE id = ${jobId} AND status = 'processing' AND lease_token = ${leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  return released.count === 1
}

export type ReplayJobs = {
  claim(report: WorkerReport): Promise<ClaimedJob | null>
  complete(input: { jobId: string; leaseToken: string; line: string }): Promise<CompleteOutcome>
  fail(input: { jobId: string; leaseToken: string; code: JobFailureCode; message: string }): Promise<boolean>
  renew(jobId: string, leaseToken: string): Promise<boolean>
  release(jobId: string, leaseToken: string): Promise<boolean>
}

export function createReplayJobs(deps: ReplaysDeps): ReplayJobs {
  return {
    claim: (report) => claimJob(deps, report),
    complete: (input) => completeJob(deps, input),
    fail: (input) => failJob(deps, input),
    renew: (jobId, leaseToken) => renewLease(deps, jobId, leaseToken),
    release: (jobId, leaseToken) => releaseJob(deps, jobId, leaseToken),
  }
}
