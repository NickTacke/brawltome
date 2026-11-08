import { asc, eq } from 'drizzle-orm'
import type { DeadLetterInspection } from '../model'
import { interactiveRefreshEffects } from './tables'
import type { Transaction } from './transaction'

export async function readInteractiveEffects(
  transaction: Transaction,
  effectOperationId: string,
): Promise<DeadLetterInspection['interactiveEffects']> {
  const rows = await transaction
    .select()
    .from(interactiveRefreshEffects)
    .where(eq(interactiveRefreshEffects.operationId, effectOperationId))
    .orderBy(asc(interactiveRefreshEffects.section))

  return rows.map((effect) => ({
    section: effect.section,
    leaseToken: effect.leaseToken,
    completedAt: effect.completedAt.toISOString(),
  }))
}
