import { and, eq, sql } from 'drizzle-orm'
import type { WorkClass } from '../model'
import { payloadMatches } from './payload-matches'
import { operations } from './tables'
import type { Transaction } from './transaction'

export type PromotePendingWorkClassInput = {
  kind: string
  resourceKey: string
  from: WorkClass
  to: WorkClass
  // top-level payload keys the pending operation must hold, as text
  payloadEquals: Record<string, string>
  // top-level payload keys to set on the promoted operation, replacing what it held
  payloadMerge?: Record<string, unknown>
}

/**
 * Moves the pending operation on a resource to another work class, so a more urgent request is not queued behind it.
 * A merge widens what it does for that request; it can only touch an operation no worker has started.
 */
export async function promotePendingWorkClass(
  transaction: Transaction,
  input: PromotePendingWorkClassInput,
): Promise<void> {
  await transaction
    .update(operations)
    .set({
      workClass: input.to,
      // sent as text: a string bound as jsonb would arrive as one json string, not the object
      payload: sql`${operations.payload} || ${JSON.stringify(input.payloadMerge ?? {})}::text::jsonb`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(operations.kind, input.kind),
        eq(operations.resourceKey, input.resourceKey),
        eq(operations.status, 'pending'),
        eq(operations.workClass, input.from),
        ...payloadMatches(input.payloadEquals),
      ),
    )
}
