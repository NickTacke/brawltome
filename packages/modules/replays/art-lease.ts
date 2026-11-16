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

/**
 * Ends an attempt with a failure: a final one fails the job and the match's art, any other gives the job back for
 * another attempt. Returns whether this attempt still held the job.
 */
export async function finishArtWithFailure(
  sql: Sql | TransactionSql,
  job: { id: string; leaseToken: string },
  failure: ArtFailure,
  isFinal: boolean,
): Promise<boolean> {
  if (!isFinal) return giveBack(sql, job, { isAttempt: true })

  const failureJson = JSON.stringify(failure)

  // one statement, so the job and its match's art never disagree
  const [failed] = await sql<{ count: number }[]>`
    WITH failed AS (
      UPDATE replays.art_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp(), failure = ${failureJson}::text::jsonb
      WHERE id = ${job.id} AND status = 'processing' AND lease_token = ${job.leaseToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING match_id
    ), marked AS (
      UPDATE replays.matches SET art_state = 'failed', art_failure = ${failureJson}::text::jsonb
      WHERE id IN (SELECT match_id FROM failed)
    )
    SELECT count(*)::int AS count FROM failed
  `

  return failed?.count === 1
}

/** Puts a job back in the queue; an attempt that didn't run (a release) doesn't count. */
export async function giveBack(
  sql: Sql | TransactionSql,
  job: { id: string; leaseToken: string },
  options: { isAttempt: boolean },
): Promise<boolean> {
  const attemptsReturned = options.isAttempt ? 0 : 1

  const returned = await sql`
    UPDATE replays.art_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, timeline_key = NULL,
      attempts = greatest(attempts - ${attemptsReturned}, 0), updated_at = clock_timestamp()
    WHERE id = ${job.id} AND status = 'processing' AND lease_token = ${job.leaseToken}
      AND lease_expires_at > clock_timestamp()
  `

  return returned.count === 1
}

/** Fails the jobs whose last attempt never answered, and their matches' art. */
export async function failExhaustedArtJobs(sql: Sql): Promise<void> {
  const failureJson = JSON.stringify({ code: 'worker-error', message: `no answer after ${MAX_ATTEMPTS} attempts` })

  await sql`
    WITH exhausted AS (
      UPDATE replays.art_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp(), failure = ${failureJson}::text::jsonb
      WHERE status = 'processing' AND lease_expires_at <= clock_timestamp() AND attempts >= ${MAX_ATTEMPTS}
      RETURNING match_id
    )
    UPDATE replays.matches SET art_state = 'failed', art_failure = ${failureJson}::text::jsonb
    WHERE id IN (SELECT match_id FROM exhausted)
  `
}
