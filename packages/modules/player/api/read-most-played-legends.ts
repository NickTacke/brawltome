import type { MostPlayedLegendsContract, SeasonStartContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { type LegendGames, readLegendGames } from '../db/read-legend-games'
import { firstDetectedSeason } from '../ranked/season-starts'

function withShares(legends: LegendGames[]) {
  const totalGames = legends.reduce((sum, legend) => sum + legend.games, 0)

  return legends.map((legend) => ({ ...legend, share: legend.games / totalGames }))
}

/**
 * Each legend's share of the ranked games seen this season. Null until a season start has been detected, because
 * before that any stored snapshot could hold an older season's games.
 */
export async function readMostPlayedLegends(
  database: Database,
  seasons: SeasonStartContract[],
): Promise<MostPlayedLegendsContract> {
  const current = seasons.at(-1)

  if (!current || current.season < firstDetectedSeason) return null

  const { playerCount, legends } = await readLegendGames(database, current.startsAt)

  return { ...current, playerCount, legends: withShares(legends) }
}
