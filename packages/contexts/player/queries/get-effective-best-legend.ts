import { type Database, player, playerStatsLegend } from '@brawltome/database'
import { getLegendById } from '@brawltome/shared'
import { desc, eq, inArray } from 'drizzle-orm'

export interface EffectiveBestLegend {
  legendId: number
  legendNameKey: string
}

export async function getEffectiveBestLegend(db: Database, brawlhallaId: number): Promise<EffectiveBestLegend | null> {
  const p = await db.query.player.findFirst({
    where: eq(player.brawlhallaId, brawlhallaId),
    columns: { bestLegend: true },
  })
  if (p?.bestLegend && p.bestLegend > 0) {
    const meta = getLegendById(p.bestLegend)
    return { legendId: p.bestLegend, legendNameKey: meta?.legendNameKey ?? '' }
  }

  const top = await db.query.playerStatsLegend.findFirst({
    where: eq(playerStatsLegend.brawlhallaId, brawlhallaId),
    orderBy: [desc(playerStatsLegend.level), desc(playerStatsLegend.xp)],
    columns: { legendId: true, legendNameKey: true },
  })
  if (!top) return null
  return { legendId: top.legendId, legendNameKey: top.legendNameKey }
}

export async function getEffectiveBestLegendsBatch(
  db: Database,
  brawlhallaIds: number[],
): Promise<Map<number, EffectiveBestLegend>> {
  if (brawlhallaIds.length === 0) return new Map()

  const explicits = await db.query.player.findMany({
    where: inArray(player.brawlhallaId, brawlhallaIds),
    columns: { brawlhallaId: true, bestLegend: true },
  })

  const result = new Map<number, EffectiveBestLegend>()
  const fallbackIds: number[] = []

  for (const p of explicits) {
    if (p.bestLegend && p.bestLegend > 0) {
      const meta = getLegendById(p.bestLegend)
      result.set(p.brawlhallaId, {
        legendId: p.bestLegend,
        legendNameKey: meta?.legendNameKey ?? '',
      })
      continue
    }
    fallbackIds.push(p.brawlhallaId)
  }

  if (fallbackIds.length > 0) {
    const rows = await db.query.playerStatsLegend.findMany({
      where: inArray(playerStatsLegend.brawlhallaId, fallbackIds),
      orderBy: [desc(playerStatsLegend.level), desc(playerStatsLegend.xp)],
      columns: { brawlhallaId: true, legendId: true, legendNameKey: true },
    })
    for (const row of rows) {
      if (!result.has(row.brawlhallaId)) {
        result.set(row.brawlhallaId, { legendId: row.legendId, legendNameKey: row.legendNameKey })
      }
    }
  }

  return result
}
