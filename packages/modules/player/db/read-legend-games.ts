import type { Database } from '@brawltome/foundation'

export type LegendGames = { legendNameKey: string; games: number }

export type SeasonLegendGames = { playerCount: number; legends: LegendGames[] }

// sums are bigint, which the driver hands back as text
type LegendGamesRow = { legend_name_key: string; games: string }

/**
 * Ranked games per legend from every player whose ranked snapshot was taken at or after `startsAt`, most played first.
 * A snapshot holds the counts of the season it was taken in, so one taken before the start is last season's.
 */
export async function readLegendGames(database: Database, startsAt: string): Promise<SeasonLegendGames> {
  const [legendRows, [players]] = await Promise.all([
    database.sql<LegendGamesRow[]>`
      SELECT legend.legend_name_key, sum(legend.games) AS games
      FROM players.ranked_profiles profile
      JOIN players.ranked_legends legend USING (brawlhalla_id)
      WHERE profile.last_success_at >= ${startsAt} AND legend.games > 0
      GROUP BY legend.legend_name_key
      ORDER BY games DESC, legend.legend_name_key
    `,
    database.sql<{ player_count: number }[]>`
      SELECT count(*)::int AS player_count
      FROM players.ranked_profiles profile
      WHERE profile.last_success_at >= ${startsAt}
        AND EXISTS (
          SELECT 1 FROM players.ranked_legends legend
          WHERE legend.brawlhalla_id = profile.brawlhalla_id AND legend.games > 0
        )
    `,
  ])

  const legends = legendRows.map((row) => ({ legendNameKey: row.legend_name_key, games: Number(row.games) }))

  return { playerCount: players.player_count, legends }
}
