import type { PlayerRepo } from '@brawltome/player'
import { DEFAULT_PAGE_SIZE, type LeaderboardInput, MAX_PAGES, MAX_PAGE_SIZE } from '../ranking'
import type { RankingRepo } from '../ranking.repo'

const STALE_RANK_MS = 72 * 60 * 60 * 1000

export async function getLeaderboard(
  deps: { rankingRepo: RankingRepo; playerRepo: PlayerRepo },
  input: LeaderboardInput,
) {
  const page = Math.max(1, Math.min(input.page, MAX_PAGES))
  const pageSize = Math.max(1, Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const sort = input.sort ?? 'rating'
  const order = input.order ?? 'desc'
  const offset = (page - 1) * pageSize

  if (input.bracket === '2v2') {
    return get2v2Leaderboard(deps, { ...input, page, pageSize, sort, order, offset })
  }

  if (input.bracket === 'solo2v2') {
    return getSolo2v2Leaderboard(deps, { ...input, page, pageSize, sort, order, offset })
  }

  return get1v1Leaderboard(deps, { ...input, page, pageSize, sort, order, offset })
}

async function get1v1Leaderboard(
  deps: { rankingRepo: RankingRepo; playerRepo: PlayerRepo },
  opts: LeaderboardInput & {
    pageSize: number
    sort: 'rating' | 'peakRating' | 'wins' | 'games'
    order: 'asc' | 'desc'
    offset: number
  },
) {
  const blacklistSet = await deps.rankingRepo.getBlacklistedIds()
  const freshSince = new Date(Date.now() - STALE_RANK_MS)
  const rows = await deps.playerRepo.get1v1LeaderboardByRank({
    region: opts.region,
    pageSize: opts.pageSize,
    offset: opts.offset,
    freshSince,
    blacklistSet,
  })

  const effective = await deps.playerRepo.getEffectiveBestLegendsBatch(rows.map((r) => r.brawlhallaId))

  const entries = rows.map((r) => ({
    ...r,
    bestLegendNameKey: effective.get(r.brawlhallaId)?.legendNameKey ?? null,
  }))

  return { entries, page: opts.page, pageSize: opts.pageSize }
}

async function get2v2Leaderboard(
  deps: { rankingRepo: RankingRepo; playerRepo: PlayerRepo },
  opts: LeaderboardInput & {
    pageSize: number
    sort: 'rating' | 'peakRating' | 'wins' | 'games'
    order: 'asc' | 'desc'
    offset: number
  },
) {
  const blacklistSet = await deps.rankingRepo.getBlacklistedIds()
  const freshSince = new Date(Date.now() - STALE_RANK_MS)
  const results = await deps.playerRepo.get2v2LeaderboardByRank({
    region: opts.region,
    pageSize: opts.pageSize,
    offset: opts.offset,
    freshSince,
  })

  const seen = new Set<string>()
  const deduped = results.filter((t) => {
    const min = Math.min(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const max = Math.max(t.brawlhallaIdOne, t.brawlhallaIdTwo)
    const key = `${min}:${max}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const filtered = deduped.filter((t) => !blacklistSet.has(t.brawlhallaIdOne) && !blacklistSet.has(t.brawlhallaIdTwo))
  const paged = filtered.slice(opts.offset, opts.offset + opts.pageSize)

  const playerIds = [...new Set(paged.flatMap((t) => [t.brawlhallaIdOne, t.brawlhallaIdTwo]))]
  const [nameMap, effective, regionMap] = await Promise.all([
    deps.playerRepo.getPlayerNames(playerIds),
    deps.playerRepo.getEffectiveBestLegendsBatch(playerIds),
    deps.playerRepo.getPlayerRegions(playerIds),
  ])

  const entries = paged.map((t, i) => ({
    ...t,
    region: regionMap.get(t.brawlhallaIdOne) ?? regionMap.get(t.brawlhallaIdTwo) ?? t.region,
    rank: t.globalRank && t.globalRank > 0 ? t.globalRank : opts.offset + i + 1,
    playerOneName: nameMap.get(t.brawlhallaIdOne) ?? 'Unknown',
    playerTwoName: nameMap.get(t.brawlhallaIdTwo) ?? 'Unknown',
    playerOneBestLegendNameKey: effective.get(t.brawlhallaIdOne)?.legendNameKey ?? null,
    playerTwoBestLegendNameKey: effective.get(t.brawlhallaIdTwo)?.legendNameKey ?? null,
  }))

  return { entries, page: opts.page, pageSize: opts.pageSize }
}

async function getSolo2v2Leaderboard(
  deps: { rankingRepo: RankingRepo; playerRepo: PlayerRepo },
  opts: LeaderboardInput & {
    pageSize: number
    sort: 'rating' | 'peakRating' | 'wins' | 'games'
    order: 'asc' | 'desc'
    offset: number
  },
) {
  const blacklistSet = await deps.rankingRepo.getBlacklistedIds()
  const results = await deps.playerRepo.getSolo2v2Leaderboard({
    region: opts.region,
    sort: opts.sort,
    order: opts.order,
    pageSize: opts.pageSize,
    offset: opts.offset,
    blacklistSet,
  })

  const playerIds = results.map((r) => r.brawlhallaId)
  const [nameMap, effective] = await Promise.all([
    deps.playerRepo.getPlayerNames(playerIds),
    deps.playerRepo.getEffectiveBestLegendsBatch(playerIds),
  ])

  const entries = results.map((r, i) => ({
    brawlhallaId: r.brawlhallaId,
    name: nameMap.get(r.brawlhallaId) || 'Unknown',
    rating: r.rating,
    peakRating: r.peakRating,
    tier: r.tier,
    wins: r.wins,
    games: r.games,
    region: r.region,
    rank: opts.offset + i + 1,
    bestLegendNameKey: effective.get(r.brawlhallaId)?.legendNameKey ?? null,
  }))

  return { entries, page: opts.page, pageSize: opts.pageSize }
}
