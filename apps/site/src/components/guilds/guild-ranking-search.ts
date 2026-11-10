import { parsePage } from '../page-number'

// checked against the contract in the tests, the contract's schemas stay out of the browser bundle
export const lastGuildRankingPage = 100_000

export type GuildRankingSearch = { page?: number }

export function parseGuildRankingSearch(search: Record<string, unknown>): GuildRankingSearch {
  return { page: parsePage(search.page, lastGuildRankingPage) }
}
