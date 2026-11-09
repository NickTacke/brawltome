import { sql } from 'drizzle-orm'
import type { Transaction } from './transaction'

export const wakeupChannel = 'refresh_operations_wakeup'

/** Tells idle workers that an operation can be claimed, when the transaction commits. */
export async function notifyWakeup(transaction: Transaction, operationId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_notify(${wakeupChannel}, ${operationId})`)
}
