import { getLegendById, normalizeWeaponName } from '@brawltome/shared'
import { type PlayerResult, enrichStatsLegend } from '../player'
import type { PlayerRepo } from '../player.repo'

export async function getPlayer(repo: PlayerRepo, brawlhallaId: number): Promise<PlayerResult | null> {
  const p = await repo.findById(brawlhallaId)
  if (!p) return null

  // Collect teammate IDs (the OTHER side of each ranked-team row). Solo entries have
  // brawlhallaIdTwo === 0, so the "teammate" is 0 — skip those.
  const teammateIds = new Set<number>()
  for (const t of p.rankedTeams) {
    const other = t.brawlhallaIdOne === brawlhallaId ? t.brawlhallaIdTwo : t.brawlhallaIdOne
    if (other > 0) teammateIds.add(other)
  }

  const [history, effective, teammateNames] = await Promise.all([
    repo.getRatingHistory(brawlhallaId),
    repo.getEffectiveBestLegend(brawlhallaId),
    teammateIds.size > 0 ? repo.getPlayerNames([...teammateIds]) : Promise.resolve(new Map<number, string>()),
  ])

  const enrichedStatsLegends = (p.statsLegends || []).map((l) =>
    enrichStatsLegend(l, getLegendById, normalizeWeaponName),
  )

  // Attach teammateName so the frontend doesn't have to derive it from teamName
  // (the new sweep no longer populates teamName — endpoint doesn't return it).
  const rankedTeams = p.rankedTeams.map((t) => {
    const other = t.brawlhallaIdOne === brawlhallaId ? t.brawlhallaIdTwo : t.brawlhallaIdOne
    return { ...t, teammateName: other > 0 ? (teammateNames.get(other) ?? null) : null }
  })

  return {
    ...p,
    rankedTeams,
    statsLegends: enrichedStatsLegends,
    ratingHistory: history,
    bestLegend: effective?.legendId ?? p.bestLegend ?? 0,
    bestLegendNameKey: effective?.legendNameKey ?? null,
  }
}
