import { eq } from 'drizzle-orm'
import { operations } from './tables'
import type { Transaction } from './transaction'

/** Locks the effect's first operation, so nothing can seal it between a guard's check and the replay. */
export async function lockEffectOperation(transaction: Transaction, effectOperationId: string): Promise<void> {
  await transaction
    .select({ id: operations.id })
    .from(operations)
    .where(eq(operations.id, effectOperationId))
    .for('update')
}
