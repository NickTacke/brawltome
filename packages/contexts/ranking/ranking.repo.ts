import type { Database } from '@brawltome/database'
import { blacklist } from '@brawltome/database'

export function createRankingRepo(db: Database) {
  return {
    getBlacklistedIds() {
      return db
        .select({ brawlhallaId: blacklist.brawlhallaId })
        .from(blacklist)
        .then((rows) => new Set(rows.map((b) => b.brawlhallaId)))
    },
  }
}

export type RankingRepo = ReturnType<typeof createRankingRepo>
