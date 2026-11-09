import type { Database } from '@brawltome/foundation'
import { type CreateClanWeeklySnapshotSchedule, reconcileFixedSchedule } from '@brawltome/queue'
import { clanWeeklySnapshotContract } from './clan-weekly-snapshot-contract'

export function reconcileClanWeeklySnapshotSchedule(database: Database, schedule: CreateClanWeeklySnapshotSchedule) {
  return reconcileFixedSchedule(database, { job: clanWeeklySnapshotContract, schedule })
}
