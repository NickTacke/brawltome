import { getLegendById, normalizeWeaponName } from '@brawltome/shared'
import { type PlayerResult, enrichStatsLegend } from '../player'
import type { PlayerRepo } from '../player.repo'

export async function getPlayer(repo: PlayerRepo, brawlhallaId: number): Promise<PlayerResult | null> {
  const blocked = await repo.isBlacklisted(brawlhallaId)
  if (blocked) return null

  const p = await repo.findById(brawlhallaId)
  if (!p) return null

  const [history, effective] = await Promise.all([
    repo.getRatingHistory(brawlhallaId),
    repo.getEffectiveBestLegend(brawlhallaId),
  ])

  const enrichedStatsLegends = (p.statsLegends || []).map((l) =>
    enrichStatsLegend(l, getLegendById, normalizeWeaponName),
  )

  return {
    ...p,
    statsLegends: enrichedStatsLegends,
    ratingHistory: history,
    bestLegend: effective?.legendId ?? p.bestLegend ?? 0,
    bestLegendNameKey: effective?.legendNameKey ?? null,
  }
}
