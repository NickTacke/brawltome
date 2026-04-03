import type { PlayerRepo } from '../player.repo'
import { enrichStatsLegend, type PlayerResult } from '../player'
import { getLegendById, normalizeWeaponName } from '@brawltome/shared'

export async function getPlayer(
  repo: PlayerRepo,
  brawlhallaId: number,
): Promise<PlayerResult | null> {
  const blocked = await repo.isBlacklisted(brawlhallaId)
  if (blocked) return null

  const p = await repo.findById(brawlhallaId)
  if (!p) return null

  const history = await repo.getRatingHistory(brawlhallaId)

  const enrichedStatsLegends = (p.statsLegends || []).map((l) =>
    enrichStatsLegend(l, getLegendById, normalizeWeaponName),
  )

  return { ...p, statsLegends: enrichedStatsLegends, ratingHistory: history }
}
