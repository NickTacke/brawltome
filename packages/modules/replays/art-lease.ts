import type { Sql, TransactionSql } from '@brawltome/foundation'
import { MAX_ATTEMPTS } from './limits'

// every answer from the worker about an art job is fenced by its lease, as for parse jobs, so an attempt that lost
// its lease can't end or overwrite a newer one

export type ArtFailureCode = 'no-animations' | 'export-failed' | 'worker-error'
export type ArtFailure = { code: ArtFailureCode; message: string }

export type LiveArtJob = {
  id: string
  kind: 'match' | 'warm'
  matchId: string | null
  patch: string
  attempts: number
  // the line the worker was handed
  timelineKey: string | null
}

export async function findLiveArtJob(
  sql: Sql,
  jobId: string,
  leaseToken: string,
): Promise<LiveArtJob | 'not-found' | 'lease-lost'> {
  const [job] = await sql<(LiveArtJob & { live: boolean })[]>`
    SELECT id, kind, match_id AS "matchId", patch, attempts, timeline_key AS "timelineKey",
      (status = 'processing' AND lease_token = ${leaseToken} AND lease_expires_at > clock_timestamp()) AS live
    FROM replays.art_jobs WHERE id = ${jobId}
  `

  if (!job) return 'not-found'

  if (!job.live) return 'lease-lost'

  return job
}

export type FailureOutcome = 'failed' | 'given-back' | 'lease-lost'

type LeasedJob = { id: string; leaseToken: string }

// whether the lease must still run, or must have run out (a job out of attempts)
type LeaseFence = { isLeaseLive: boolean }

/**
 * Ends an attempt with a failure: a final one fails the job and the match's art, any other gives the job back for
 * another attempt. A failure for a line a re-parse has since replaced gives the job back to run on the new line:
 * the re-parse queued no job of its own while this one was active.
 */
export async function finishArtWithFailure(
  sql: Sql,
  job: LeasedJob,
  failure: ArtFailure,
  isFinal: boolean,
): Promise<FailureOutcome> {
  if (!isFinal) return (await giveBack(sql, job, { isAttempt: true })) ? 'given-back' : 'lease-lost'

  return failUnlessLineReplaced(sql, job, failure, { isLeaseLive: true })
}

/** Fails the jobs whose last attempt never answered, and their matches' art. */
export async function failExhaustedArtJobs(sql: Sql): Promise<void> {
  const failure: ArtFailure = { code: 'worker-error', message: `no answer after ${MAX_ATTEMPTS} attempts` }

  const exhausted = await sql<LeasedJob[]>`
    SELECT id, lease_token AS "leaseToken" FROM replays.art_jobs
    WHERE status = 'processing' AND lease_expires_at <= clock_timestamp() AND attempts >= ${MAX_ATTEMPTS}
  `

  for (const job of exhausted) await failUnlessLineReplaced(sql, job, failure, { isLeaseLive: false })
}

async function failUnlessLineReplaced(
  sql: Sql,
  job: LeasedJob,
  failure: ArtFailure,
  fence: LeaseFence,
): Promise<FailureOutcome> {
  return sql.begin(async (transaction) => {
    const isReplaced = await lockIsLineReplaced(transaction, job.id)

    if (isReplaced) return (await restartArtJob(transaction, job, fence)) ? 'given-back' : 'lease-lost'

    return (await failJobAndArt(transaction, job, failure, fence)) ? 'failed' : 'lease-lost'
  })
}

// locks the match row before the job row is touched, the order a re-parse takes them in, so neither waits on the
// other. a warm job has no match, and no line to replace
async function lockIsLineReplaced(transaction: TransactionSql, jobId: string): Promise<boolean> {
  const [line] = await transaction<{ isReplaced: boolean }[]>`
    SELECT match.timeline_key IS DISTINCT FROM job.timeline_key AS "isReplaced"
    FROM replays.art_jobs AS job
    JOIN replays.matches AS match ON match.id = job.match_id
    WHERE job.id = ${jobId}
    FOR UPDATE OF match
  `

  return line?.isReplaced ?? false
}

// one statement, so the job and its match's art never disagree
async function failJobAndArt(
  transaction: TransactionSql,
  job: LeasedJob,
  failure: ArtFailure,
  fence: LeaseFence,
): Promise<boolean> {
  const failureJson = JSON.stringify(failure)

  const [failed] = await transaction<{ count: number }[]>`
    WITH failed AS (
      UPDATE replays.art_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp(), failure = ${failureJson}::text::jsonb
      WHERE id = ${job.id} AND status = 'processing' AND lease_token = ${job.leaseToken}
        AND (lease_expires_at > clock_timestamp()) = ${fence.isLeaseLive}
      RETURNING match_id
    ), marked AS (
      UPDATE replays.matches SET art_state = 'failed', art_failure = ${failureJson}::text::jsonb
      WHERE id IN (SELECT match_id FROM failed)
    )
    SELECT count(*)::int AS count FROM failed
  `

  return failed?.count === 1
}

/**
 * Puts a job back in the queue with its attempts reset, when its line was replaced or its art must be drawn again in
 * a newer format: that is new work.
 */
export async function restartArtJob(sql: Sql | TransactionSql, job: LeasedJob, fence: LeaseFence): Promise<boolean> {
  const restarted = await sql`
    UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, timeline_key = NULL,
      attempts = 0, updated_at = clock_timestamp()
    WHERE id = ${job.id} AND status = 'processing' AND lease_token = ${job.leaseToken}
      AND (lease_expires_at > clock_timestamp()) = ${fence.isLeaseLive}
  `

  return restarted.count === 1
}

/** Puts a job back in the queue; an attempt that didn't run (a release) doesn't count. */
export async function giveBack(sql: Sql, job: LeasedJob, options: { isAttempt: boolean }): Promise<boolean> {
  const attemptsReturned = options.isAttempt ? 0 : 1

  const returned = await sql`
    UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, timeline_key = NULL,
      attempts = greatest(attempts - ${attemptsReturned}, 0), updated_at = clock_timestamp()
    WHERE id = ${job.id} AND status = 'processing' AND lease_token = ${job.leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  return returned.count === 1
}
