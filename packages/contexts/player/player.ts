import type {
  player,
  playerAlias,
  playerClan,
  playerRankedLegend,
  playerRankedTeam,
  playerStatsLegend,
  playerWeaponStat,
  ratingHistory,
} from '@brawltome/database'
import type { LegendData } from '@brawltome/shared'
import type { InferSelectModel } from 'drizzle-orm'

export const DISCOVERY_MIN_TOKENS = 50
export const VALHALLAN_GRACE_MS = 3 * 60 * 60 * 1000

export type EnrichedStatsLegend = InferSelectModel<typeof playerStatsLegend> & {
  weaponOne: string | null
  weaponTwo: string | null
  bioName: string | null
}

export type PlayerResult = InferSelectModel<typeof player> & {
  aliases: InferSelectModel<typeof playerAlias>[]
  statsLegends: EnrichedStatsLegend[]
  weaponStats: InferSelectModel<typeof playerWeaponStat>[]
  clan: InferSelectModel<typeof playerClan> | null
  rankedLegends: InferSelectModel<typeof playerRankedLegend>[]
  rankedTeams: Array<InferSelectModel<typeof playerRankedTeam> & { teammateName: string | null }>
  ratingHistory: InferSelectModel<typeof ratingHistory>[]
  bestLegendNameKey: string | null
}

export function isValhallanGraced(tier: string | null, confirmedAt: Date | null): boolean {
  return !!(tier?.startsWith('Valhallan') && confirmedAt && Date.now() - confirmedAt.getTime() < VALHALLAN_GRACE_MS)
}

export function isStale(lastUpdated: Date | null, ttlMs: number): boolean {
  return !lastUpdated || Date.now() - lastUpdated.getTime() > ttlMs
}

export function enrichStatsLegend(
  legend: InferSelectModel<typeof playerStatsLegend>,
  getLegendFn: (id: number) => LegendData | undefined,
  normalizeFn: (name: string) => string,
): EnrichedStatsLegend {
  const legendData = getLegendFn(legend.legendId)
  return {
    ...legend,
    // Resolve the slug from the legend cache (single source of truth) so avatars stay correct even
    // when the denormalized playerStatsLegend.legendNameKey was written from a stale/wrong cache.
    legendNameKey: legendData?.legendNameKey ?? legend.legendNameKey,
    weaponOne: legendData ? normalizeFn(legendData.weaponOne) : null,
    weaponTwo: legendData ? normalizeFn(legendData.weaponTwo) : null,
    bioName: legendData?.bioName ?? null,
  }
}

export function computeBestLegend(legends: Array<{ legend_id: number; games: number; wins: number }>): {
  id: number
  games: number
  wins: number
} {
  return legends.reduce(
    (best, l) => (l.games > best.games ? { id: l.legend_id, games: l.games, wins: l.wins } : best),
    { id: 0, games: 0, wins: 0 },
  )
}

export function shouldSnapshotRating(
  rating: number,
  lastSnapshot: { rating: number; games: number } | null,
  currentGames: number,
): boolean {
  return rating > 0 && (!lastSnapshot || lastSnapshot.rating !== rating || lastSnapshot.games !== currentGames)
}
