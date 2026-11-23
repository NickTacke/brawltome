import type { Database } from '@brawltome/foundation'
import { and, eq, sql } from 'drizzle-orm'
import type { JobContract } from '../jobs/job-definition'
import { assertValidJobInput } from '../jobs/job-input'
import type { WorkClass } from '../model'
import { operations } from './tables'

export type RewritePendingOperationInput<Payload> = {
  job: JobContract<Payload>
  operationId: string
  // the payload the caller read and built on: a rewrite by someone else in between makes this one miss
  expectedPayload: unknown
  workClass: WorkClass
  payload: Payload
}

// sent as text: a string bound as jsonb would arrive as one json string, not the object
function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::text::jsonb`
}

/**
 * Gives a pending operation a new work class and payload, for a request that needs more of it, sooner. Only pending:
 * a worker reads the payload when it claims, and a reservation awaiting admission belongs to whoever is admitting it.
 * False when it was claimed, settled or rewritten after the caller read it, so the caller can read it again.
 */
export async function rewritePendingOperation<Payload>(
  database: Database,
  input: RewritePendingOperationInput<Payload>,
): Promise<boolean> {
  assertValidJobInput(input.job as JobContract<unknown>, input.workClass, input.payload)

  const rewritten = await database.db
    .update(operations)
    .set({
      workClass: input.workClass,
      payload: jsonb(input.payload),
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(operations.id, input.operationId),
        eq(operations.kind, input.job.kind),
        eq(operations.status, 'pending'),
        sql`${operations.payload} = ${jsonb(input.expectedPayload)}`,
      ),
    )
    .returning({ id: operations.id })

  return rewritten.length > 0
}
