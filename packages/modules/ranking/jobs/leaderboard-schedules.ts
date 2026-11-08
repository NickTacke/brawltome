import type { Database } from '@brawltome/foundation'
import {
  type CreateLeaderboardDeepCrawlSchedule,
  type CreateLeaderboardSchedule,
  disableFixedSchedule,
  reconcileFixedSchedule,
} from '@brawltome/refresh-operations'

export function reconcileLeaderboardSchedule(database: Database, schedule: CreateLeaderboardSchedule) {
  return reconcileFixedSchedule(database, { schedule })
}

// deep crawl is switched by worker configuration, so turning it back on re-enables a paused schedule
export function reconcileLeaderboardDeepCrawlSchedule(
  database: Database,
  schedule: CreateLeaderboardDeepCrawlSchedule,
) {
  return reconcileFixedSchedule(database, { schedule, reenable: true })
}

export function disableLeaderboardDeepCrawlSchedule(database: Database, scheduleKey: string) {
  return disableFixedSchedule(database, { scheduleKey, kind: 'leaderboard-deep-crawl' })
}
