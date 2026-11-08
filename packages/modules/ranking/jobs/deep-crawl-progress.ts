import type { Database } from '@brawltome/foundation'
import { readDeepCrawlProgress, saveDeepCrawlProgress } from '../db/deep-crawl-progress'

export function createLeaderboardDeepCrawlProgress(database: Database) {
  return {
    read: (mode: string, region: string) => readDeepCrawlProgress(database, mode, region),
    save: (input: Parameters<typeof saveDeepCrawlProgress>[1]) => saveDeepCrawlProgress(database, input),
  }
}
