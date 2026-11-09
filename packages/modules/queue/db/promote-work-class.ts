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
}

/** Moves the pending operation on a resource to another work class, so a more urgent request is not queued behind it. */
export async function promotePendingWorkClass(
  transaction: Transaction,
  input: PromotePendingWorkClassInput,
): Promise<void> {
  await transaction
    .update(operations)
    .set({ workClass: input.to, updatedAt: sql`clock_timestamp()` })
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
