import type { Database, Sql } from '@brawltome/foundation'
import type { Lease } from '../jobs/job-definition'
import type { OperationFailure, TransitionResult } from '../model'

/** Puts an operation whose effect landed back in the queue, to wait for its owner to acknowledge the effect. */
export function retryAppliedEffect(
  database: Database,
  lease: Lease<unknown>,
  retryDelayMs: number,
): Promise<TransitionResult> {
  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    const [updated] = await sql<{ id: string }[]>`
      UPDATE queue.operations
      SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
          available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
          last_error = ${sql.json({
            code: 'discovery_projection_acknowledgment_pending',
            message: 'Discovery projection applied; owner acknowledgment remains pending',
          })},
          updated_at = clock_timestamp()
      WHERE id = ${lease.operationId} AND kind = ${lease.kind} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `

    if (!updated) return 'lease-lost' as const

    await sql`
      UPDATE queue.attempts
      SET finished_at = clock_timestamp(), outcome = 'retry',
          error = ${sql.json({
            code: 'discovery_projection_acknowledgment_pending',
            message: 'Discovery projection applied; owner acknowledgment remains pending',
          })}
      WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
    `

    return 'transitioned' as const
  })
}

/** Gives the attempt back: the operation waits for its delay and the deferred attempt does not count. */
export async function deferOperation(
  database: Database,
  lease: Lease<unknown>,
  failure: OperationFailure,
  retryDelayMs: number,
): Promise<TransitionResult> {
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('source admission retry delay must be a non-negative safe integer')
  }

  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    const [owned] = await sql<{ attempt_count: number }[]>`
      SELECT attempt_count FROM queue.operations
      WHERE id = ${lease.operationId} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      FOR UPDATE
    `

    if (!owned || owned.attempt_count !== lease.attemptNumber) return 'lease-lost' as const

    const [removed] = await sql<{ operation_id: string }[]>`
      DELETE FROM queue.attempts
      WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
      RETURNING operation_id
    `

    if (!removed) return 'lease-lost' as const

    await sql`
      UPDATE queue.operations
      SET status = 'pending', attempt_count = attempt_count - 1,
          lease_owner = NULL, lease_expires_at = NULL,
          available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
          last_error = ${sql.json(failure)},
          updated_at = clock_timestamp()
      WHERE id = ${lease.operationId}
    `

    return 'transitioned' as const
  })
}

export function completeOperation(database: Database, lease: Lease<unknown>): Promise<TransitionResult> {
  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    const updated = await sql<{ id: string }[]>`
      UPDATE queue.operations
      SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = ${lease.operationId} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `

    if (!updated[0]) return 'lease-lost' as const

    await sql`
      UPDATE queue.attempts
      SET finished_at = clock_timestamp(), outcome = 'succeeded'
      WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
    `

    return 'transitioned' as const
  })
}

/** Ends the attempt with a failure: retried while attempts remain and the failure allows it, otherwise dead letter. */
export function failOperation(
  database: Database,
  lease: Lease<unknown>,
  failure: OperationFailure,
  retryDelayMs: number,
): Promise<TransitionResult> {
  return database.sql.begin(async (transaction) => {
    const sql = transaction as unknown as Sql

    const [owned] = await sql<{ attempt_count: number; max_attempts: number }[]>`
      SELECT attempt_count, max_attempts FROM queue.operations
      WHERE id = ${lease.operationId} AND status = 'leased'
        AND lease_owner = ${lease.leaseOwner} AND lease_token = ${lease.leaseToken}
        AND lease_expires_at > clock_timestamp()
      FOR UPDATE
    `

    if (!owned) return 'lease-lost' as const

    const retry = failure.retryable && owned.attempt_count < owned.max_attempts

    await sql`
      UPDATE queue.attempts
      SET finished_at = clock_timestamp(), outcome = ${retry ? 'retry' : 'dead_letter'},
          error = ${sql.json(failure)}
      WHERE operation_id = ${lease.operationId} AND attempt_number = ${lease.attemptNumber}
    `

    await sql`
      UPDATE queue.operations
      SET status = ${retry ? 'pending' : 'dead_letter'}, lease_owner = NULL, lease_expires_at = NULL,
          available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
          completed_at = ${retry ? null : sql`clock_timestamp()`},
          last_error = ${sql.json(failure)}, updated_at = clock_timestamp()
      WHERE id = ${lease.operationId}
    `

    return 'transitioned' as const
  })
}
