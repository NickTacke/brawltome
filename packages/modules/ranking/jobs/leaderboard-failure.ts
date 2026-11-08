import { type FailureDecision, failureDetails, type RetryTimings, sourceWaitMs } from '@brawltome/refresh-operations'
import { LeaderboardLeaseLostError } from '../leaderboard'
import { LeaderboardSourceError } from '../v1-leaderboard-source'

// thrown after a slice so the crawl gives the leaderboard slot back; the dispatcher defers it without spending an
// attempt and the regular 15-minute collections, queued earlier, run first
export class LeaderboardDeepCrawlYield extends Error {
  constructor() {
    super('Leaderboard deep crawl yielded between slices')
  }
}

// null leaves the error to the dispatcher's source and execution rules
export function decideLeaderboardFailure(error: unknown, retry: RetryTimings): FailureDecision | null {
  if (error instanceof LeaderboardLeaseLostError) return { action: 'lease-lost' }

  if (error instanceof LeaderboardDeepCrawlYield) {
    return {
      action: 'defer',
      failure: { code: 'deep_crawl_yield', message: error.message, retryable: true },
      delayMs: 0,
      category: 'admission_deferred',
    }
  }

  if (error instanceof LeaderboardSourceError && error.retryable) {
    return {
      action: 'defer',
      failure: failureDetails(error, error.code),
      delayMs: sourceWaitMs(retry),
      category: error.code === 'source_rate_limited' ? 'source_rate_limited' : 'source_unavailable',
    }
  }

  return null
}
