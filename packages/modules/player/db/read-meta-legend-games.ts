import type { Database } from '@brawltome/foundation'

// fewer games is a legend tried out, not one the player plays
export const metaGamesFloor = 10

// below this an average rating swings on a handful of players
export const metaPlayersFloor = 30

export type MetaLegendGames = {
  legendNameKey: string
  games: number
  wins: number
  playerCount: number
  averageRating: number
}

// sums are bigint, which the driver hands back as text
type MetaLegendGamesRow = {
  legend_name_key: string
  games: string
  wins: string
  player_count: number
  average_rating: number
}

/**
 * The legends players have played at least ten times this season, ranked by the average rating those players hold on
 * them, then by games. Only snapshots taken at or after `startsAt` count; one taken before holds last season's games.
 */
export async function readMetaLegendGames(
  database: Database,
  startsAt: string,
  minimumPlayers = metaPlayersFloor,
): Promise<MetaLegendGames[]> {
  const rows = await database.sql<MetaLegendGamesRow[]>`
    SELECT
      legend.legend_name_key,
      sum(legend.games) AS games,
      sum(legend.wins) AS wins,
      count(*)::int AS player_count,
      round(avg(legend.rating))::int AS average_rating
    FROM players.ranked_profiles profile
    JOIN players.ranked_legends legend USING (brawlhalla_id)
    WHERE profile.last_success_at >= ${startsAt}
      AND legend.games >= ${metaGamesFloor}
    GROUP BY legend.legend_name_key
    HAVING count(*) >= ${minimumPlayers}
    ORDER BY average_rating DESC, games DESC, legend.legend_name_key
  `

  return rows.map((row) => ({
    legendNameKey: row.legend_name_key,
    games: Number(row.games),
    wins: Number(row.wins),
    playerCount: row.player_count,
    averageRating: row.average_rating,
  }))
}
