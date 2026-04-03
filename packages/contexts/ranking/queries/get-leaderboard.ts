import { getLegendById } from '@brawltome/shared'
import { DEFAULT_PAGE_SIZE, type LeaderboardInput, MAX_PAGES, MAX_PAGE_SIZE } from '../ranking'
import type { RankingRepo } from '../ranking.repo'

export async function getLeaderboard(repo: RankingRepo, input: LeaderboardInput) {
  const page = Math.max(1, Math.min(input.page, MAX_PAGES))
  const pageSize = Math.max(1, Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const sort = input.sort ?? 'rating'
  const order = input.order ?? 'desc'
  const offset = (page - 1) * pageSize

  if (input.bracket === '2v2') {
    return get2v2Leaderboard(repo, { ...input, page, pageSize, sort, order, offset })
  }

  return get1v1Leaderboard(repo, { ...input, page, pageSize, sort, order, offset })
}

async function get1v1Leaderboard(
  repo: RankingRepo,
  opts: LeaderboardInput & {
    pageSize: number
    sort: 'rating' | 'peakRating' | 'wins' | 'games'
    order: 'asc' | 'desc'
    offset: number
  },
) {
  const blacklistSet = await repo.getBlacklistedIds()
  const results = await repo.get1v1Leaderboard({
    region: opts.region,
    sort: opts.sort,
    order: opts.order,
    pageSize: opts.pageSize,
    offset: opts.offset,
    blacklistSet,
  })

  const entries = results.map((entry) => ({
    ...entry,
    bestLegendNameKey: entry.bestLegend != null ? (getLegendById(entry.bestLegend)?.legendNameKey ?? null) : null,
  }))

  return { entries, page: opts.page, pageSize: opts.pageSize }
}

async function get2v2Leaderboard(
  repo: RankingRepo,
  opts: LeaderboardInput & {
    pageSize: number
    sort: 'rating' | 'peakRating' | 'wins' | 'games'
    order: 'asc' | 'desc'
    offset: number
  },
) {
  const blacklistSet = await repo.getBlacklistedIds()
  const results = await repo.get2v2Leaderboard({
    region: opts.region,
    sort: opts.sort,
    order: opts.order,
    pageSize: opts.pageSize,
    offset: opts.offset,
  })

  // Deduplicate teams by canonicalizing ID pair (min, max)
  const seen = new Set<string>()
  const deduped = results.filter((t) => {
    const min = Math.min(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const max = Math.max(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const key = `${min}:${max}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Filter blacklisted and take page size
  const filtered = deduped
    .filter((t) => !blacklistSet.has(t.brawlhallaIdOne) && !blacklistSet.has(t.brawlhallaIdTwo))
    .slice(0, opts.pageSize)

  // Enrich with player names
  const playerIds = [...new Set(filtered.flatMap((t) => [t.brawlhallaIdOne, t.brawlhallaIdTwo]))]
  const nameMap = await repo.getPlayerNames(playerIds)

  const entries = filtered.map((t, i) => {
    const nameParts = (t.teamName ?? '').split('+')
    return {
      ...t,
      rank: opts.offset + i + 1,
      playerOneName: nameMap.get(t.brawlhallaIdOne) || nameParts[0]?.trim() || 'Unknown',
      playerTwoName: nameMap.get(t.brawlhallaIdTwo) || nameParts[1]?.trim() || 'Unknown',
    }
  })

  return { entries, page: opts.page, pageSize: opts.pageSize }
}
