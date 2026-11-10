import type { Database } from '@brawltome/foundation'

// the 1v1 rating a player needs before their games count, well above the 2000 where diamond starts
export const metaRatingFloor = 2200

// early in a season fewer high rated players have been seen, and the shares swing on a handful of them
export const metaPlayersFloor = 100

export type MetaLegendGames = { legendNameKey: string; games: number; wins: number; playerCount: number }

// sums are bigint, which the driver hands back as text
type MetaLegendGamesRow = { legend_name_key: string; games: string; wins: string; player_count: number }

async function countHighRatedPlayers(database: Database, startsAt: string): Promise<number> {
  const [players] = await database.sql<{ player_count: number }[]>`
    SELECT count(*)::int AS player_count
    FROM players.ranked_profiles profile
    WHERE profile.last_success_at >= ${startsAt}
      AND profile.rating >= ${metaRatingFloor}
  `

  return players.player_count
}

/**
 * Ranked games and wins per legend from the players rated 2200+ in 1v1, most played first, then by name. Only
 * snapshots taken at or after `startsAt` count; one taken before holds last season's games. Empty until a hundred of
 * those players have been seen this season.
 */
export async function readMetaLegendGames(database: Database, startsAt: string): Promise<MetaLegendGames[]> {
  const highRatedPlayerCount = await countHighRatedPlayers(database, startsAt)

  if (highRatedPlayerCount < metaPlayersFloor) return []

  const rows = await database.sql<MetaLegendGamesRow[]>`
    SELECT
      legend.legend_name_key,
      sum(legend.games) AS games,
      sum(legend.wins) AS wins,
      count(*)::int AS player_count
    FROM players.ranked_profiles profile
    JOIN players.ranked_legends legend USING (brawlhalla_id)
    WHERE profile.last_success_at >= ${startsAt}
      AND profile.rating >= ${metaRatingFloor}
      AND legend.games > 0
    GROUP BY legend.legend_name_key
    ORDER BY games DESC, legend.legend_name_key
  `

  return rows.map((row) => ({
    legendNameKey: row.legend_name_key,
    games: Number(row.games),
    wins: Number(row.wins),
    playerCount: row.player_count,
  }))
}
