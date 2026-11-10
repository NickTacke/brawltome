import type { MetaLegendsContract, SeasonStartContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { type MetaLegendGames, readMetaLegendGames } from '../db/read-meta-legend-games'
import { firstDetectedSeason } from '../ranked/season-starts'

// both over the games of every counted player together, so a player with more games weighs more
function withRates(legends: MetaLegendGames[]) {
  const totalGames = legends.reduce((sum, legend) => sum + legend.games, 0)

  return legends.map(({ wins, ...legend }) => ({
    ...legend,
    winRate: wins / legend.games,
    gameShare: legend.games / totalGames,
  }))
}

/**
 * Each legend's share of the ranked games players rated 2200+ have played this season, largest first. Null until a
 * season start has been detected, because before that any stored snapshot could hold an older season's games.
 */
export async function readMetaLegends(
  database: Database,
  seasons: SeasonStartContract[],
): Promise<MetaLegendsContract> {
  const current = seasons.at(-1)

  if (!current || current.season < firstDetectedSeason) return null

  const legends = await readMetaLegendGames(database, current.startsAt)

  return { ...current, legends: withRates(legends) }
}
