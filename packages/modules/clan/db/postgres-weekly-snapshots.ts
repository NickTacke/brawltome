import type { Database } from '@brawltome/foundation'
import type { HeldLease } from '@brawltome/queue'
import { beginWeeklySnapshot } from './begin-weekly-snapshot'
import { clearWeeklySnapshotSourceDown } from './clear-weekly-snapshot-source-down'
import { completeWeeklySnapshot } from './complete-weekly-snapshot'
import { listClansAfter } from './list-clans-after'
import { markWeeklySnapshotSourceDown } from './mark-weekly-snapshot-source-down'
import { type SkippedWeeklyGuild, type StoredWeeklyGuild, skipWeeklyGuild, storeWeeklyGuild } from './save-weekly-guild'

/** The weekly snapshot use cases bound to one database, for the snapshot job. Every write checks the job's lease. */
export function createPostgresWeeklySnapshots(database: Database) {
  return {
    begin: (weekStarting: string) => beginWeeklySnapshot(database, weekStarting),

    listClansAfter: (lastClanId: number, limit: number) => listClansAfter(database, lastClanId, limit),

    storeGuild: (lease: HeldLease, guild: StoredWeeklyGuild) => storeWeeklyGuild(database, lease, guild),

    skipGuild: (lease: HeldLease, guild: SkippedWeeklyGuild) => skipWeeklyGuild(database, lease, guild),

    markSourceDown: (lease: HeldLease, weekStarting: string) =>
      markWeeklySnapshotSourceDown(database, lease, weekStarting),

    clearSourceDown: (lease: HeldLease, weekStarting: string) =>
      clearWeeklySnapshotSourceDown(database, lease, weekStarting),

    complete: (lease: HeldLease, weekStarting: string) => completeWeeklySnapshot(database, lease, weekStarting),
  }
}

export type PostgresWeeklySnapshots = ReturnType<typeof createPostgresWeeklySnapshots>
