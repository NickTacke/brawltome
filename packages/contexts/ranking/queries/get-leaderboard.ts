import type { PlayerRepo } from '@brawltome/player/v2-compatibility'
import { DEFAULT_PAGE_SIZE, type LeaderboardInput, MAX_PAGE_SIZE, STALE_RANK_MS } from '../ranking'

const MAX_PAGE = 500

export async function getLeaderboard(deps: { playerRepo: PlayerRepo }, input: LeaderboardInput) {
  const page = Math.max(1, Math.min(input.page, MAX_PAGE))
  const pageSize = Math.max(1, Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const offset = (page - 1) * pageSize
  const freshSince = new Date(Date.now() - STALE_RANK_MS)

  // A full page implies there's likely at least one more; cap forces hasMore=false at the boundary.
  const computeHasMore = (count: number) => count === pageSize && page < MAX_PAGE

  if (input.bracket === '1v1') {
    const rows = await deps.playerRepo.get1v1LeaderboardSweep({ region: input.region, pageSize, offset, freshSince })
    const effective = await deps.playerRepo.getEffectiveBestLegendsBatch(rows.map((r) => r.brawlhallaId))
    return {
      entries: rows.map((r) => ({ ...r, bestLegendNameKey: effective.get(r.brawlhallaId)?.legendNameKey ?? null })),
      page,
      pageSize,
      hasMore: computeHasMore(rows.length),
    }
  }

  if (input.bracket === '3v3') {
    const rows = await deps.playerRepo.get3v3LeaderboardSweep({ region: input.region, pageSize, offset, freshSince })
    const effective = await deps.playerRepo.getEffectiveBestLegendsBatch(rows.map((r) => r.brawlhallaId))
    return {
      entries: rows.map((r) => ({ ...r, bestLegendNameKey: effective.get(r.brawlhallaId)?.legendNameKey ?? null })),
      page,
      pageSize,
      hasMore: computeHasMore(rows.length),
    }
  }

  if (input.bracket === 'solo2v2') {
    const rows = await deps.playerRepo.getSolo2v2LeaderboardSweep({
      region: input.region,
      pageSize,
      offset,
      freshSince,
    })
    const ids = rows.map((r) => r.brawlhallaId)
    const [nameMap, effective] = await Promise.all([
      deps.playerRepo.getPlayerNames(ids),
      deps.playerRepo.getEffectiveBestLegendsBatch(ids),
    ])
    return {
      entries: rows.map(({ brawlhallaIdOne: _one, brawlhallaIdTwo: _two, ...rest }) => ({
        ...rest,
        name: nameMap.get(rest.brawlhallaId) ?? 'Unknown',
        bestLegendNameKey: effective.get(rest.brawlhallaId)?.legendNameKey ?? null,
      })),
      page,
      pageSize,
      hasMore: computeHasMore(rows.length),
    }
  }

  // 2v2 — raw SQL result, snake_case columns
  const teams = await deps.playerRepo.get2v2LeaderboardSweep({
    region: input.region,
    pageSize,
    offset,
    freshSince,
  })

  const playerIds = [...new Set(teams.flatMap((t) => [t.brawlhalla_id_one, t.brawlhalla_id_two]))]
  const isGlobalView = input.region === 'all'
  const [nameMap, effective, regionMap] = await Promise.all([
    deps.playerRepo.getPlayerNames(playerIds),
    deps.playerRepo.getEffectiveBestLegendsBatch(playerIds),
    isGlobalView ? deps.playerRepo.getPlayerRegions(playerIds) : Promise.resolve(new Map<number, string>()),
  ])

  return {
    entries: teams.map((t) => ({
      brawlhallaIdOne: t.brawlhalla_id_one,
      brawlhallaIdTwo: t.brawlhalla_id_two,
      teamName: t.team_name,
      rating: t.rating,
      peakRating: t.peak_rating,
      tier: t.tier,
      wins: t.wins,
      games: t.games,
      region: isGlobalView
        ? (regionMap.get(t.brawlhalla_id_one) ?? regionMap.get(t.brawlhalla_id_two) ?? t.region)
        : t.region,
      rank: t.rank,
      playerOneName: nameMap.get(t.brawlhalla_id_one) ?? 'Unknown',
      playerTwoName: nameMap.get(t.brawlhalla_id_two) ?? 'Unknown',
      playerOneBestLegendNameKey: effective.get(t.brawlhalla_id_one)?.legendNameKey ?? null,
      playerTwoBestLegendNameKey: effective.get(t.brawlhalla_id_two)?.legendNameKey ?? null,
    })),
    page,
    pageSize,
    hasMore: computeHasMore(teams.length),
  }
}
