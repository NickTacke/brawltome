import type { Database } from '@brawltome/foundation'
import {
  type CreateLeaderboardDeepCrawlSchedule,
  type CreateLeaderboardSchedule,
  disableFixedSchedule,
  reconcileFixedSchedule,
} from '@brawltome/refresh-operations'
import { leaderboardCollectionContract, leaderboardDeepCrawlContract } from './leaderboard-job-contracts'

export function reconcileLeaderboardSchedule(database: Database, schedule: CreateLeaderboardSchedule) {
  return reconcileFixedSchedule(database, { job: leaderboardCollectionContract(schedule.kind), schedule })
}

// deep crawl is switched by worker configuration, so turning it back on re-enables a paused schedule
export function reconcileLeaderboardDeepCrawlSchedule(
  database: Database,
  schedule: CreateLeaderboardDeepCrawlSchedule,
) {
  return reconcileFixedSchedule(database, { job: leaderboardDeepCrawlContract, schedule, reenable: true })
}

export function disableLeaderboardDeepCrawlSchedule(database: Database, scheduleKey: string) {
  return disableFixedSchedule(database, { scheduleKey, kind: 'leaderboard-deep-crawl' })
}
