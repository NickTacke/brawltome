import type { Database } from '@brawltome/foundation'
import { acquireActiveLeaseInTransaction, type HeldLease } from '@brawltome/queue'
import type { Transaction } from './transaction'

export type WeeklySnapshotWriteResult<Result> = Result | 'lease-lost'

/**
 * Runs a weekly snapshot write only while the worker still holds the operation's lease. The queue's lease fence is
 * checked in the write's own transaction, so a worker whose lease ran out while it waited on the source can't
 * overwrite the work of the worker that took over.
 */
export async function writeUnderLease<Result>(
  database: Database,
  lease: HeldLease,
  write: (transaction: Transaction) => Promise<Result>,
): Promise<WeeklySnapshotWriteResult<Result>> {
  return database.db.transaction(async (transaction) => {
    const isLeaseHeld = await acquireActiveLeaseInTransaction(transaction, lease)

    if (!isLeaseHeld) return 'lease-lost'

    return write(transaction)
  })
}
