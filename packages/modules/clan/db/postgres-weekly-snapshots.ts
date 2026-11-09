import type { Database } from '@brawltome/foundation'
import { beginWeeklySnapshot } from './begin-weekly-snapshot'
import { completeWeeklySnapshot } from './complete-weekly-snapshot'
import { listClansAfter } from './list-clans-after'
import { recordWeeklySnapshot, type WeeklySnapshotRecord } from './record-weekly-snapshot'

/** The weekly snapshot use cases bound to one database, for the snapshot job. */
export function createPostgresWeeklySnapshots(database: Database) {
  return {
    begin: (weekStarting: string) => beginWeeklySnapshot(database, weekStarting),

    listClansAfter: (lastClanId: number, limit: number) => listClansAfter(database, lastClanId, limit),

    record: (record: WeeklySnapshotRecord) => recordWeeklySnapshot(database, record),

    complete: (weekStarting: string) => completeWeeklySnapshot(database, weekStarting),
  }
}

export type PostgresWeeklySnapshots = ReturnType<typeof createPostgresWeeklySnapshots>
