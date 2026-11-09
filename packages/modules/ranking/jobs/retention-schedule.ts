import type { Database } from '@brawltome/foundation'
import { type CreateRankingRetentionSchedule, disableFixedSchedule, reconcileFixedSchedule } from '@brawltome/queue'
import { rankingRetentionContract } from './ranking-retention-contract'

// turning retention back on re-enables a schedule that was paused
export function reconcileRankingRetentionSchedule(database: Database, schedule: CreateRankingRetentionSchedule) {
  return reconcileFixedSchedule(database, { job: rankingRetentionContract, schedule, reenable: true })
}

export function disableRankingRetentionSchedule(database: Database, scheduleKey: string) {
  return disableFixedSchedule(database, { scheduleKey, kind: 'ranking-retention' })
}
