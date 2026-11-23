import type { Database } from '@brawltome/foundation'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { JobContract } from '../jobs/job-definition'
import { assertValidJobInput } from '../jobs/job-input'
import type { WorkClass } from '../model'
import { operations } from './tables'

// a worker reads the payload when it claims the operation, so once leased it can no longer change
const unstartedStatuses = ['awaiting_admission', 'pending'] as const

export type RewriteUnstartedOperationInput<Payload> = {
  job: JobContract<Payload>
  operationId: string
  workClass: WorkClass
  payload: Payload
}

/**
 * Gives an operation no worker has started a new work class and payload, for a request that needs more of it, sooner.
 * False when it was leased or settled in the meantime, so the caller can look again.
 */
export async function rewriteUnstartedOperation<Payload>(
  database: Database,
  input: RewriteUnstartedOperationInput<Payload>,
): Promise<boolean> {
  assertValidJobInput(input.job as JobContract<unknown>, input.workClass, input.payload)

  const rewritten = await database.db
    .update(operations)
    .set({
      workClass: input.workClass,
      // sent as text: a string bound as jsonb would arrive as one json string, not the object
      payload: sql`${JSON.stringify(input.payload)}::text::jsonb`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(operations.id, input.operationId),
        eq(operations.kind, input.job.kind),
        inArray(operations.status, unstartedStatuses),
      ),
    )
    .returning({ id: operations.id })

  return rewritten.length > 0
}
