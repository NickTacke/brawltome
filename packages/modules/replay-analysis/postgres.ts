import postgres from 'postgres'
import {
  ActiveReplayJobError,
  type ClaimedReplayJob,
  type ReplayAnalysisJobs,
  type ReplayJobDetail,
  type ReplayJobFailure,
  type ReplayJobStatus,
  type ReplayJobSummary,
} from './index'

type JobRow = {
  id: string
  status: ReplayJobStatus
  file_name: string | null
  created_at: Date
  updated_at: Date
  failure: ReplayJobFailure | null
  result?: unknown | null
}

type ClaimedJobRow = {
  id: string
  lease_token: string
  replay_bytes: Uint8Array
  replay_digest: string
}

function summary(row: JobRow): ReplayJobSummary {
  return {
    id: row.id,
    status: row.status,
    fileName: row.file_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    failure: row.failure,
  }
}

export function createPostgresReplayAnalysisJobs(connectionString: string): ReplayAnalysisJobs {
  const client = postgres(connectionString, { max: 5 })

  return {
    async create(input) {
      const [row] = await client<JobRow[]>`
        INSERT INTO replay_analysis.jobs (account_id, replay_bytes, replay_digest, file_name)
        VALUES (${input.accountId}, ${input.replayBytes}, ${input.replayDigest}, ${input.fileName})
        ON CONFLICT (account_id) WHERE status IN ('pending', 'processing') DO NOTHING
        RETURNING id, status, file_name, created_at, updated_at, failure
      `
      if (!row) throw new ActiveReplayJobError('Account already has an active replay job')
      return summary(row)
    },

    async list(accountId, limit = 20) {
      const rows = await client<JobRow[]>`
        SELECT id, status, file_name, created_at, updated_at, failure
        FROM replay_analysis.jobs
        WHERE account_id = ${accountId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `
      return rows.map(summary)
    },

    async get(accountId, id) {
      const [row] = await client<JobRow[]>`
        SELECT id, status, file_name, created_at, updated_at, failure, result
        FROM replay_analysis.jobs
        WHERE account_id = ${accountId} AND id = ${id}
      `
      if (!row) return null
      return { ...summary(row), result: row.result ?? null } satisfies ReplayJobDetail
    },

    async claim(leaseSeconds) {
      const [row] = await client<ClaimedJobRow[]>`
        WITH candidate AS (
          SELECT id
          FROM replay_analysis.jobs
          WHERE status = 'pending'
             OR (status = 'processing' AND lease_expires_at <= clock_timestamp())
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE replay_analysis.jobs AS job
        SET status = 'processing',
            lease_token = gen_random_uuid(),
            lease_expires_at = clock_timestamp() + ${leaseSeconds} * interval '1 second',
            updated_at = clock_timestamp()
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.id, job.lease_token, job.replay_bytes, job.replay_digest
      `
      if (!row) return null
      return {
        id: row.id,
        leaseToken: row.lease_token,
        replayBytes: new Uint8Array(row.replay_bytes),
        replayDigest: row.replay_digest,
      } satisfies ClaimedReplayJob
    },

    async complete(id, leaseToken, replayDigest, result) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [job] = await sql<
          { lease_active: boolean; lease_token: string | null; replay_digest: string; status: ReplayJobStatus }[]
        >`
          SELECT lease_token, replay_digest, status, lease_expires_at > clock_timestamp() AS lease_active
          FROM replay_analysis.jobs
          WHERE id = ${id}
          FOR UPDATE
        `
        if (!job) return 'not-found' as const
        if (job.status !== 'processing' || job.lease_token !== leaseToken || !job.lease_active)
          return 'lease-lost' as const
        if (job.replay_digest !== replayDigest) return 'digest-mismatch' as const
        const updated = await sql<{ id: string }[]>`
          UPDATE replay_analysis.jobs
          SET status = 'completed', result = ${sql.json(result as never)}, failure = NULL,
              replay_bytes = NULL, lease_token = NULL, lease_expires_at = NULL,
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = ${id} AND status = 'processing' AND lease_token = ${leaseToken}
            AND lease_expires_at > clock_timestamp()
          RETURNING id
        `
        return updated.length > 0 ? ('completed' as const) : ('lease-lost' as const)
      })
    },

    async fail(id, leaseToken, failure) {
      const rows = await client<{ id: string }[]>`
        UPDATE replay_analysis.jobs
        SET status = 'failed', failure = ${client.json(failure)}, result = NULL,
            replay_bytes = NULL, lease_token = NULL, lease_expires_at = NULL,
            completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = ${id} AND status = 'processing' AND lease_token = ${leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `
      return rows.length > 0
    },

    async renew(id, leaseToken, leaseSeconds) {
      const rows = await client<{ id: string }[]>`
        UPDATE replay_analysis.jobs
        SET lease_expires_at = clock_timestamp() + ${leaseSeconds} * interval '1 second',
            updated_at = clock_timestamp()
        WHERE id = ${id} AND status = 'processing' AND lease_token = ${leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `
      return rows.length > 0
    },

    async release(id, leaseToken) {
      const rows = await client<{ id: string }[]>`
        UPDATE replay_analysis.jobs
        SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${id} AND status = 'processing' AND lease_token = ${leaseToken}
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `
      return rows.length > 0
    },

    async close() {
      await client.end()
    },
  }
}
