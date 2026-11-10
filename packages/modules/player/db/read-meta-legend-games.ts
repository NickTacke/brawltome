import type { Database } from '@brawltome/foundation'

// diamond starts at 2000, so these are the players at the top of the ladder
export const metaRatingFloor = 2000

// fewer games is a legend tried out, not one the player plays
export const metaGamesFloor = 10

export type MetaLegendGames = { legendNameKey: string; games: number; wins: number; playerCount: number }

// sums are bigint, which the driver hands back as text
type MetaLegendGamesRow = { legend_name_key: string; games: string; wins: string; player_count: number }

/**
 * Ranked games and wins per legend from the legends players rated 2000+ have played at least ten times, counting only
 * snapshots taken at or after `startsAt`, most played first. One taken before the start holds last season's counts.
 */
export async function readMetaLegendGames(database: Database, startsAt: string): Promise<MetaLegendGames[]> {
  const rows = await database.sql<MetaLegendGamesRow[]>`
    SELECT
      legend.legend_name_key,
      sum(legend.games) AS games,
      sum(legend.wins) AS wins,
      count(*)::int AS player_count
    FROM players.ranked_profiles profile
    JOIN players.ranked_legends legend USING (brawlhalla_id)
    WHERE profile.last_success_at >= ${startsAt}
      AND legend.rating >= ${metaRatingFloor}
      AND legend.games >= ${metaGamesFloor}
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
