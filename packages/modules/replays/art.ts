import type { Sql } from '@brawltome/foundation'
import { type ArtResult, completeArtJob } from './art-complete'
import {
  type ArtFailure,
  type ArtJobKind,
  deferArtJob,
  failExhaustedArtJobs,
  findLiveArtJob,
  finishArtWithFailure,
  giveBack,
  type LiveArtJob,
} from './art-lease'
import { parseArtPath } from './art-paths'
import { queueArtJob, queuePredrawJob, queueWarmJob } from './art-queue'
import { unstoredArtPaths } from './art-stored'
import { type StoreArtOutcome, storeArtFile } from './art-upload'
import type { CompleteOutcome } from './jobs'
import { LEASE_SECONDS, MAX_ART_PATHS_PER_CALL, MAX_ATTEMPTS } from './limits'
import { noteWorkerReport } from './maintenance'
import type { ReplaysDeps, WorkerReport } from './model'

// after a match is stored, the worker on VM 106 exports its legends' art: it claims an art job, asks which files the
// art bucket lacks, sends those, then the manifest. the worker holds no storage keys and its uploads aren't trusted:
// every file is checked against its path before it is stored, and a manifest only once the bucket has every file it
// names. a predraw job draws a patch's pre-drawn sets and its set index the same way; once the patch has an index, a
// worker that can draw from sets is handed it with each match job of the patch

export type ClaimedArtJob = {
  jobId: string
  leaseToken: string
  kind: ArtJobKind
  patch: string
  matchId: string | null
  // the match's line, gzipped as stored; null for a warm or predraw job
  line: Uint8Array | null
  // the patch's set index (sets/<sha256>.json), for a match job claimed by a worker that can draw from sets
  setIndex: string | null
}

export type ReadArtOutcome =
  | { status: 'found'; bytes: Uint8Array }
  | { status: 'not-found' }
  | { status: 'refused'; reason: string }
  | { status: 'lease-lost' }

/**
 * The next art job, warm jobs first, then predraw jobs, then the newest match; null when there is nothing to do. Only
 * a worker that reports a set format is handed predraw jobs and set indexes.
 */
export async function claimArtJob(deps: ReplaysDeps, report: WorkerReport): Promise<ClaimedArtJob | null> {
  if (!deps.artStore) return null

  await noteWorkerReport(deps, report)
  await failExhaustedArtJobs(deps.database.sql)

  const canDrawSets = typeof report.setFormat === 'number'

  for (;;) {
    const job = await takeNextArtJob(deps.database.sql, canDrawSets)

    if (!job) return null

    const claimed = {
      jobId: job.id,
      leaseToken: job.leaseToken,
      kind: job.kind,
      patch: job.patch,
      matchId: job.matchId,
    }

    if (job.kind !== 'match') return { ...claimed, line: null, setIndex: null }

    const line = job.timelineKey ? await deps.objectStore.get(job.timelineKey) : null
    const setIndex = canDrawSets ? await setIndexOf(deps.database.sql, job.patch) : null

    if (line) return { ...claimed, line, setIndex }

    // nothing to export from, unless a re-parse replaced the line just now: the job then goes back with the new
    // one and the next turn of the loop takes it again
    const failure: ArtFailure = { code: 'export-failed', message: 'the match has no stored line' }

    await finishArtWithFailure(deps.database.sql, job, failure, true)
  }
}

// a pending job that waits for its patch's sets is passed by until its wait is over
async function takeNextArtJob(sql: Sql, canDrawSets: boolean): Promise<(LiveArtJob & { leaseToken: string }) | null> {
  const [job] = await sql<(LiveArtJob & { leaseToken: string })[]>`
    WITH candidate AS (
      SELECT job.id FROM replays.art_jobs AS job
      LEFT JOIN replays.matches AS match ON match.id = job.match_id
      WHERE (
          (job.status = 'pending' AND (job.wait_until IS NULL OR job.wait_until <= clock_timestamp()))
          OR (job.status = 'processing' AND job.lease_expires_at <= clock_timestamp() AND job.attempts < ${MAX_ATTEMPTS})
        )
        AND (job.kind <> 'predraw' OR ${canDrawSets})
      ORDER BY job.kind = 'warm' DESC, job.kind = 'predraw' DESC, match.played_at DESC NULLS LAST, match.created_at DESC,
        job.created_at, job.id
      FOR UPDATE OF job SKIP LOCKED
      LIMIT 1
    )
    UPDATE replays.art_jobs AS job SET status = 'processing', attempts = job.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
      timeline_key = (SELECT timeline_key FROM replays.matches WHERE id = job.match_id), wait_until = NULL,
      claimed_at = clock_timestamp(), updated_at = clock_timestamp()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id, job.kind, job.match_id AS "matchId", job.patch, job.attempts, job.timeline_key AS "timelineKey",
      job.lease_token AS "leaseToken"
  `

  return job ?? null
}

async function setIndexOf(sql: Sql, patch: string): Promise<string | null> {
  const [index] = await sql<{ path: string }[]>`SELECT path FROM replays.set_indexes WHERE patch = ${patch}`

  return index?.path ?? null
}

/** The paths the art bucket doesn't hold yet, of those the worker means to use. */
export async function missingArtFiles(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  paths: string[],
): Promise<string[] | 'lease-lost'> {
  if (paths.length > MAX_ART_PATHS_PER_CALL) {
    throw new Error(`list missing art files for job ${jobId}: ${paths.length} paths, over ${MAX_ART_PATHS_PER_CALL}`)
  }

  const job = await findLiveArtJob(deps.database.sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return 'lease-lost'

  return unstoredArtPaths(deps.database.sql, paths)
}

/**
 * A stored art group, map file or set index. A render reads the groups and map files it doesn't make again to name
 * their sheets in the manifest, and a render from sets reads its patch's index, so only these kinds are handed out; the
 * sheets and packs they name stay in the bucket.
 */
export async function readArtFile(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  path: string,
): Promise<ReadArtOutcome> {
  const artStore = deps.artStore

  if (!artStore) throw new Error(`read art file ${path} for job ${jobId}: this process has no art bucket`)

  const kind = parseArtPath(path)?.kind

  if (kind !== 'art' && kind !== 'map' && kind !== 'set-index') {
    return { status: 'refused', reason: `${path} is not an art group, map file or set index` }
  }

  const job = await findLiveArtJob(deps.database.sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return { status: 'lease-lost' }

  const bytes = await artStore.get(path)

  if (!bytes) return { status: 'not-found' }

  return { status: 'found', bytes }
}

/** Records the worker's failure; only worker-error is retried, and only while attempts are left. */
export async function failArtJob(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  failure: ArtFailure,
): Promise<boolean> {
  const job = await findLiveArtJob(deps.database.sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return false

  const isFinal = failure.code !== 'worker-error' || job.attempts >= MAX_ATTEMPTS
  const trimmed = { code: failure.code, message: failure.message.slice(0, 500) }
  const outcome = await finishArtWithFailure(deps.database.sql, { id: jobId, leaseToken }, trimmed, isFinal)

  return outcome !== 'lease-lost'
}

export async function renewArtLease(deps: ReplaysDeps, jobId: string, leaseToken: string): Promise<boolean> {
  const renewed = await deps.database.sql`
    UPDATE replays.art_jobs SET lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
      updated_at = clock_timestamp()
    WHERE id = ${jobId} AND status = 'processing' AND lease_token = ${leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  return renewed.count === 1
}

/** Gives a job back unplayed, for a worker shutting down; it doesn't count as an attempt. */
export async function releaseArtJob(deps: ReplaysDeps, jobId: string, leaseToken: string): Promise<boolean> {
  return giveBack(deps.database.sql, { id: jobId, leaseToken }, { isAttempt: false })
}

/**
 * Gives a match job back unplayed for a while: the sets its patch's index names aren't all in the art bucket yet, and
 * drawing the match's players itself would only be thrown away once they are. False for a lost lease or another kind.
 */
export async function waitForSets(deps: ReplaysDeps, jobId: string, leaseToken: string): Promise<boolean> {
  const job = await findLiveArtJob(deps.database.sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost' || job.kind !== 'match') return false

  return deferArtJob(deps.database.sql, { id: jobId, leaseToken })
}

export type ReplayArtJobs = {
  queue(matchId: string): Promise<void>
  queueWarm(patch: string): Promise<void>
  queuePredraw(patch: string): Promise<void>
  claim(report: WorkerReport): Promise<ClaimedArtJob | null>
  missing(jobId: string, leaseToken: string, paths: string[]): Promise<string[] | 'lease-lost'>
  store(jobId: string, leaseToken: string, path: string, bytes: Uint8Array): Promise<StoreArtOutcome>
  read(jobId: string, leaseToken: string, path: string): Promise<ReadArtOutcome>
  complete(jobId: string, leaseToken: string, result: ArtResult): Promise<CompleteOutcome>
  fail(jobId: string, leaseToken: string, failure: ArtFailure): Promise<boolean>
  renew(jobId: string, leaseToken: string): Promise<boolean>
  release(jobId: string, leaseToken: string): Promise<boolean>
  wait(jobId: string, leaseToken: string): Promise<boolean>
}

export function createReplayArtJobs(deps: ReplaysDeps): ReplayArtJobs {
  return {
    queue: (matchId) => queueArtJob(deps, matchId),
    queueWarm: (patch) => queueWarmJob(deps, patch),
    queuePredraw: (patch) => queuePredrawJob(deps, patch),
    claim: (report) => claimArtJob(deps, report),
    missing: (jobId, leaseToken, paths) => missingArtFiles(deps, jobId, leaseToken, paths),
    store: (jobId, leaseToken, path, bytes) => storeArtFile(deps, jobId, leaseToken, path, bytes),
    read: (jobId, leaseToken, path) => readArtFile(deps, jobId, leaseToken, path),
    complete: (jobId, leaseToken, result) => completeArtJob(deps, jobId, leaseToken, result),
    fail: (jobId, leaseToken, failure) => failArtJob(deps, jobId, leaseToken, failure),
    renew: (jobId, leaseToken) => renewArtLease(deps, jobId, leaseToken),
    release: (jobId, leaseToken) => releaseArtJob(deps, jobId, leaseToken),
    wait: (jobId, leaseToken) => waitForSets(deps, jobId, leaseToken),
  }
}
