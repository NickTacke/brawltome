import { sql } from 'drizzle-orm'
import type { Transaction } from './transaction'

/** Holds the schedule key until the transaction ends, so two workers cannot define the same schedule at once. */
export async function lockScheduleKey(transaction: Transaction, scheduleKey: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scheduleKey}))`)
}
