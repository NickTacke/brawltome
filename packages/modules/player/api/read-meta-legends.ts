import type { MetaLegendsContract, SeasonStartContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { type MetaLegendGames, readMetaLegendGames } from '../db/read-meta-legend-games'
import { firstDetectedSeason } from '../ranked/season-starts'

// over the games of every counted player together, so a player with more games weighs more
function withWinRate({ wins, ...legend }: MetaLegendGames) {
  return { ...legend, winRate: wins / legend.games }
}

/**
 * The legends high rated players play this season. Null until a season start has been detected, because before that
 * any stored snapshot could hold an older season's games.
 */
export async function readMetaLegends(
  database: Database,
  seasons: SeasonStartContract[],
): Promise<MetaLegendsContract> {
  const current = seasons.at(-1)

  if (!current || current.season < firstDetectedSeason) return null

  const legends = await readMetaLegendGames(database, current.startsAt)

  return { ...current, legends: legends.map(withWinRate) }
}
