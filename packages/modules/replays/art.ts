import type { ObjectStore, Sql } from '@brawltome/foundation'
import { type ArtResult, completeArtJob } from './art-complete'
import {
  type ArtFailure,
  failExhaustedArtJobs,
  findLiveArtJob,
  finishArtWithFailure,
  giveBack,
  type LiveArtJob,
} from './art-lease'
import { parseArtPath, verifyArtFile } from './art-paths'
import { queueArtJob, queueWarmJob } from './art-queue'
import type { CompleteOutcome } from './jobs'
import { LEASE_SECONDS, MAX_ART_PATHS_PER_CALL, MAX_ATTEMPTS } from './limits'
import { noteWorkerReport } from './maintenance'
import type { ReplaysDeps, WorkerReport } from './model'

// after a match is stored, the worker on VM 106 exports its legends' art: it claims an art job, asks which files the
// art bucket lacks, sends those, then the manifest. the worker holds no storage keys and its uploads aren't trusted:
// every file is checked against its path before it is stored, and a manifest only once the bucket has every file it
// names

export type ClaimedArtJob = {
  jobId: string
  leaseToken: string
  kind: 'match' | 'warm'
  patch: string
  matchId: string | null
  // the match's line, gzipped as stored; null for a warm job
  line: Uint8Array | null
}

export type StoreArtOutcome = { status: 'stored' } | { status: 'rejected'; reason: string } | { status: 'lease-lost' }

/** The next art job, warm jobs first, then the newest match; null when there is nothing to do. */
export async function claimArtJob(deps: ReplaysDeps, report: WorkerReport): Promise<ClaimedArtJob | null> {
  if (!deps.artStore) return null

  await noteWorkerReport(deps, report)
  await failExhaustedArtJobs(deps.database.sql)

  for (;;) {
    const job = await takeNextArtJob(deps.database.sql)

    if (!job) return null

    const claimed = {
      jobId: job.id,
      leaseToken: job.leaseToken,
      kind: job.kind,
      patch: job.patch,
      matchId: job.matchId,
    }

    if (job.kind === 'warm') return { ...claimed, line: null }

    const line = job.timelineKey ? await deps.objectStore.get(job.timelineKey) : null

    if (line) return { ...claimed, line }

    // nothing to export from, unless a re-parse replaced the line just now: the job then goes back with the new
    // one and the next turn of the loop takes it again
    const failure: ArtFailure = { code: 'export-failed', message: 'the match has no stored line' }

    await finishArtWithFailure(deps.database.sql, job, failure, true)
  }
}

async function takeNextArtJob(sql: Sql): Promise<(LiveArtJob & { leaseToken: string }) | null> {
  const [job] = await sql<(LiveArtJob & { leaseToken: string })[]>`
    WITH candidate AS (
      SELECT job.id FROM replays.art_jobs AS job
      LEFT JOIN replays.matches AS match ON match.id = job.match_id
      WHERE job.status = 'pending'
        OR (job.status = 'processing' AND job.lease_expires_at <= clock_timestamp() AND job.attempts < ${MAX_ATTEMPTS})
      ORDER BY job.kind = 'warm' DESC, match.played_at DESC NULLS LAST, match.created_at DESC, job.created_at, job.id
      FOR UPDATE OF job SKIP LOCKED
      LIMIT 1
    )
    UPDATE replays.art_jobs AS job SET status = 'processing', attempts = job.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + ${LEASE_SECONDS} * interval '1 second',
      timeline_key = (SELECT timeline_key FROM replays.matches WHERE id = job.match_id),
      updated_at = clock_timestamp()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id, job.kind, job.match_id AS "matchId", job.patch, job.attempts, job.timeline_key AS "timelineKey",
      job.lease_token AS "leaseToken"
  `

  return job ?? null
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

  const uniquePaths = [...new Set(paths)]

  const stored = await deps.database.sql<{ path: string }[]>`
    SELECT path FROM replays.art_files WHERE path = ANY(${uniquePaths}::text[])
  `

  const storedPaths = new Set(stored.map(({ path }) => path))

  return uniquePaths.filter((path) => !storedPaths.has(path))
}

/**
 * Checks one file from the worker and puts it in the art bucket. A path already stored is left as it is: its name
 * stands for its content or its inputs, so the stored file is the same one.
 */
export async function storeArtFile(
  deps: ReplaysDeps,
  jobId: string,
  leaseToken: string,
  path: string,
  bytes: Uint8Array,
): Promise<StoreArtOutcome> {
  const artStore = requireArtStore(deps.artStore, `store art file ${path} for job ${jobId}`)
  const problem = verifyArtFile(path, bytes)

  if (problem) return { status: 'rejected', reason: problem }

  const job = await findLiveArtJob(deps.database.sql, jobId, leaseToken)

  if (job === 'not-found' || job === 'lease-lost') return { status: 'lease-lost' }

  const [stored] = await deps.database.sql`SELECT 1 FROM replays.art_files WHERE path = ${path}`

  if (stored) return { status: 'stored' }

  // the file first, so a path in art_files is always in the bucket
  await artStore.put(path, bytes, parseArtPath(path)?.contentType as string)

  await deps.database.sql`
    INSERT INTO replays.art_files (path, bytes) VALUES (${path}, ${bytes.byteLength}) ON CONFLICT DO NOTHING
  `

  return { status: 'stored' }
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

function requireArtStore(artStore: ObjectStore | null, action: string): ObjectStore {
  if (!artStore) throw new Error(`${action}: this process has no art bucket`)

  return artStore
}

export type ReplayArtJobs = {
  queue(matchId: string): Promise<void>
  queueWarm(patch: string): Promise<void>
  claim(report: WorkerReport): Promise<ClaimedArtJob | null>
  missing(jobId: string, leaseToken: string, paths: string[]): Promise<string[] | 'lease-lost'>
  store(jobId: string, leaseToken: string, path: string, bytes: Uint8Array): Promise<StoreArtOutcome>
  complete(jobId: string, leaseToken: string, result: ArtResult): Promise<CompleteOutcome>
  fail(jobId: string, leaseToken: string, failure: ArtFailure): Promise<boolean>
  renew(jobId: string, leaseToken: string): Promise<boolean>
  release(jobId: string, leaseToken: string): Promise<boolean>
}

export function createReplayArtJobs(deps: ReplaysDeps): ReplayArtJobs {
  return {
    queue: (matchId) => queueArtJob(deps, matchId),
    queueWarm: (patch) => queueWarmJob(deps, patch),
    claim: (report) => claimArtJob(deps, report),
    missing: (jobId, leaseToken, paths) => missingArtFiles(deps, jobId, leaseToken, paths),
    store: (jobId, leaseToken, path, bytes) => storeArtFile(deps, jobId, leaseToken, path, bytes),
    complete: (jobId, leaseToken, result) => completeArtJob(deps, jobId, leaseToken, result),
    fail: (jobId, leaseToken, failure) => failArtJob(deps, jobId, leaseToken, failure),
    renew: (jobId, leaseToken) => renewArtLease(deps, jobId, leaseToken),
    release: (jobId, leaseToken) => releaseArtJob(deps, jobId, leaseToken),
  }
}
