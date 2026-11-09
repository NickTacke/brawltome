import type { PlayerRankedSummaryContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'

type RankedSummaryRow = {
  brawlhalla_id: number
  rating: number | null
  wins: number
  games: number
  ranked_main_legend_name_key: string | null
  last_success_at: Date | null
}

function toRankedSummary(row: RankedSummaryRow): PlayerRankedSummaryContract {
  return {
    brawlhallaId: row.brawlhalla_id,
    rating: row.rating,
    wins: row.wins,
    games: row.games,
    mainLegend: row.ranked_main_legend_name_key,
    updatedAt: row.last_success_at?.toISOString() ?? null,
  }
}

/** The ranked summary of each given player that has a row, in no particular order. */
export async function readRankedSummaries(
  database: Database,
  brawlhallaIds: number[],
): Promise<PlayerRankedSummaryContract[]> {
  // a rating of 0 means unrated, and a player checked but never fetched has null wins and games
  const rows = await database.sql<RankedSummaryRow[]>`
    SELECT brawlhalla_id, NULLIF(rating, 0) AS rating, COALESCE(wins, 0) AS wins, COALESCE(games, 0) AS games,
           ranked_main_legend_name_key, last_success_at
    FROM players.ranked_profiles
    WHERE brawlhalla_id = ANY(${brawlhallaIds}::integer[])
  `

  return rows.map(toRankedSummary)
}
