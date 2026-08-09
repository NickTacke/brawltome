import { randomUUID } from 'node:crypto'
import type {
  AcceptOperationResult,
  AcceptProofOperation,
  FencedResult,
  OperationFailure,
  OperationLease,
  TransitionResult,
} from '@brawltome/refresh-operations'
import postgres from 'postgres'

const wakeupChannel = 'refresh_operations_wakeup'

type OperationRow = {
  id: string
  operation_key: string
  payload: { value: string }
  provenance: { source: string; requestedBy?: string }
  lease_owner: string
  lease_token: string | number
  attempt_count: number
  max_attempts: number
  status: string
}

function toLease(row: OperationRow): OperationLease {
  return {
    operationId: row.id,
    operationKey: row.operation_key,
    payload: row.payload,
    provenance: row.provenance,
    leaseOwner: row.lease_owner,
    leaseToken: Number(row.lease_token),
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
  }
}

export function createPostgresRefreshOperations(connectionString: string) {
  const client = postgres(connectionString)

  return {
    async accept(input: AcceptProofOperation): Promise<AcceptOperationResult> {
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          const operationId = randomUUID()
          const inserted = await sql<{ id: string }[]>`
            INSERT INTO refresh_operations.operations
              (id, kind, dedupe_key, operation_key, payload, provenance, max_attempts)
            VALUES
              (${operationId}, 'proof', ${input.dedupeKey}, ${input.operationKey},
               ${sql.json(input.payload)}, ${sql.json(input.provenance)}, ${input.maxAttempts ?? 3})
            ON CONFLICT (kind, dedupe_key) WHERE status IN ('pending', 'leased')
            DO NOTHING
            RETURNING id
          `
          if (inserted[0]) {
            await sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`
            return { outcome: 'accepted' as const, operationId }
          }

          const [active] = await sql<{ id: string }[]>`
            SELECT id FROM refresh_operations.operations
            WHERE kind = 'proof' AND dedupe_key = ${input.dedupeKey} AND status IN ('pending', 'leased')
          `
          return active ? { outcome: 'already-active' as const, operationId: active.id } : null
        })
        if (result) return result
      }
    },

    async claim(workerId: string, leaseMs: number): Promise<OperationLease | null> {
      for (;;) {
        const result = await client.begin(async (transaction) => {
          const sql = transaction as unknown as typeof client
          const [candidate] = await sql<OperationRow[]>`
            SELECT id, operation_key, payload, provenance, lease_owner, lease_token,
                   attempt_count, max_attempts, status
            FROM refresh_operations.operations
            WHERE (status = 'pending' AND available_at <= clock_timestamp())
               OR (status = 'leased' AND lease_expires_at <= clock_timestamp())
            ORDER BY available_at, created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `
          if (!candidate) return { kind: 'empty' as const }

          if (candidate.status === 'leased') {
            const [effect] = await sql<{ operation_id: string }[]>`
              SELECT operation_id FROM refresh_operations.proof_effects
              WHERE operation_id = ${candidate.id}
            `
            if (effect) {
              await sql`
                UPDATE refresh_operations.attempts
                SET finished_at = clock_timestamp(), outcome = 'succeeded'
                WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
                  AND finished_at IS NULL
              `
              await sql`
                UPDATE refresh_operations.operations
                SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
                    completed_at = clock_timestamp(), updated_at = clock_timestamp()
                WHERE id = ${candidate.id}
              `
              return { kind: 'reconciled' as const }
            }
            await sql`
              UPDATE refresh_operations.attempts
              SET finished_at = clock_timestamp(), outcome = 'lease_expired',
                  error = ${sql.json({ code: 'lease_expired', message: 'Worker lease expired' })}
              WHERE operation_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
                AND finished_at IS NULL
            `
            if (candidate.attempt_count >= candidate.max_attempts) {
              await sql`
                UPDATE refresh_operations.operations
                SET status = 'dead_letter', lease_owner = NULL, lease_expires_at = NULL,
                    completed_at = clock_timestamp(), updated_at = clock_timestamp(),
                    last_error = ${sql.json({ code: 'lease_expired', message: 'Maximum attempts exhausted' })}
                WHERE id = ${candidate.id}
              `
              return { kind: 'dead-lettered' as const }
            }
          }

          const [leased] = await sql<OperationRow[]>`
            UPDATE refresh_operations.operations
            SET status = 'leased', lease_owner = ${workerId},
                lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
                lease_token = lease_token + 1, attempt_count = attempt_count + 1,
                updated_at = clock_timestamp()
            WHERE id = ${candidate.id}
            RETURNING id, operation_key, payload, provenance, lease_owner, lease_token,
                      attempt_count, max_attempts, status
          `
          await sql`
            INSERT INTO refresh_operations.attempts
              (operation_id, attempt_number, lease_token, lease_owner)
            VALUES (${leased.id}, ${leased.attempt_count}, ${leased.lease_token}, ${workerId})
          `
          return { kind: 'leased' as const, lease: toLease(leased) }
        })
        if (result.kind === 'leased') return result.lease
        if (result.kind === 'empty') return null
      }
    },

    async commitProofEffect(lease: OperationLease): Promise<FencedResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<{ id: string; operation_key: string; payload: { value: string } }[]>`
          SELECT id, operation_key, payload FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        const inserted = await sql<{ operation_key: string }[]>`
          INSERT INTO refresh_operations.proof_effects
            (operation_key, operation_id, lease_token, effect_value)
          VALUES (${owned.operation_key}, ${owned.id}, ${lease.leaseToken}, ${sql.json(owned.payload)})
          ON CONFLICT (operation_key) DO NOTHING
          RETURNING operation_key
        `
        if (inserted[0]) return 'applied' as const
        const [existing] = await sql<{ operation_id: string; matches_payload: boolean }[]>`
          SELECT operation_id, effect_value = ${sql.json(owned.payload)}::jsonb AS matches_payload
          FROM refresh_operations.proof_effects
          WHERE operation_key = ${owned.operation_key}
        `
        return existing?.operation_id === owned.id && existing.matches_payload
          ? ('already-applied' as const)
          : ('effect-conflict' as const)
      })
    },

    async complete(lease: OperationLease): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const updated = await sql<{ id: string }[]>`
          UPDATE refresh_operations.operations
          SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          RETURNING id
        `
        if (!updated[0]) return 'lease-lost' as const
        await sql`
          UPDATE refresh_operations.attempts
          SET finished_at = clock_timestamp(), outcome = 'succeeded'
          WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
        `
        return 'transitioned' as const
      })
    },

    async fail(lease: OperationLease, failure: OperationFailure, retryDelayMs: number): Promise<TransitionResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const [owned] = await sql<{ attempt_count: number; max_attempts: number }[]>`
          SELECT attempt_count, max_attempts FROM refresh_operations.operations
          WHERE id = ${lease.operationId} AND status = 'leased'
            AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
            AND lease_expires_at > clock_timestamp()
          FOR UPDATE
        `
        if (!owned) return 'lease-lost' as const
        const retry = failure.retryable && owned.attempt_count < owned.max_attempts
        await sql`
          UPDATE refresh_operations.attempts
          SET finished_at = clock_timestamp(), outcome = ${retry ? 'retry' : 'dead_letter'},
              error = ${sql.json(failure)}
          WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
        `
        await sql`
          UPDATE refresh_operations.operations
          SET status = ${retry ? 'pending' : 'dead_letter'}, lease_owner = NULL, lease_expires_at = NULL,
              available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
              completed_at = ${retry ? null : sql`clock_timestamp()`},
              last_error = ${sql.json(failure)}, updated_at = clock_timestamp()
          WHERE id = ${lease.operationId}
        `
        return 'transitioned' as const
      })
    },

    async inspect(operationId: string) {
      const [operation] = await client`
        SELECT * FROM refresh_operations.operations WHERE id = ${operationId}
      `
      const attempts = await client`
        SELECT * FROM refresh_operations.attempts WHERE operation_id = ${operationId} ORDER BY attempt_number
      `
      const effects = await client`
        SELECT * FROM refresh_operations.proof_effects WHERE operation_id = ${operationId}
      `
      return { operation, attempts, effects }
    },

    listen(onWakeup: (operationId: string) => void) {
      return client.listen(wakeupChannel, onWakeup)
    },

    async close() {
      await client.end()
    },
  }
}

export type PostgresRefreshOperations = ReturnType<typeof createPostgresRefreshOperations>
