import { type BoardMode, type BoardRegion, parseBoardSearch } from '../home/home-filters'
import { parsePage } from '../page-number'

// checked against the contract in the tests, the contract's schemas stay out of the browser bundle
export const lastLeaderboardPage = 500

export type LeaderboardSearch = { mode?: BoardMode; region?: BoardRegion; page?: number }

// defaults stay out of the address, a bare /leaderboard shows the remembered region
export function parseLeaderboardSearch(search: Record<string, unknown>): LeaderboardSearch {
  return { ...parseBoardSearch(search), page: parsePage(search.page, lastLeaderboardPage) }
}
