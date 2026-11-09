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
  // a rating of 0 means unrated, and a player checked but never fetched has null wins and games. a newer v1 pulse
  // overrides the stored record, by the same rule as the player page
  const rows = await database.sql<RankedSummaryRow[]>`
    SELECT profile.brawlhalla_id,
           NULLIF(CASE WHEN effective.is_pulse THEN COALESCE(pulse.rating, profile.rating) ELSE profile.rating END, 0) AS rating,
           COALESCE(CASE WHEN effective.is_pulse THEN COALESCE(pulse.wins, profile.wins) ELSE profile.wins END, 0) AS wins,
           COALESCE(CASE WHEN effective.is_pulse THEN COALESCE(pulse.games, profile.games) ELSE profile.games END, 0) AS games,
           profile.ranked_main_legend_name_key,
           CASE WHEN effective.is_pulse THEN GREATEST(profile.last_success_at, pulse.last_success_at)
                ELSE profile.last_success_at END AS last_success_at
    FROM players.ranked_profiles profile
    LEFT JOIN players.ranked_v1_pulse_state pulse USING (brawlhalla_id)
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        pulse.one_vs_one_effect_created_at > profile.v0_effect_created_at
          OR (pulse.one_vs_one_effect_created_at = profile.v0_effect_created_at
              AND pulse.one_vs_one_effect_operation_id > profile.v0_effect_operation_id)
          OR (pulse.one_vs_one_effect_created_at IS NOT NULL AND profile.v0_effect_created_at IS NULL),
        false
      ) AS is_pulse
    ) effective
    WHERE profile.brawlhalla_id = ANY(${brawlhallaIds}::integer[])
  `

  return rows.map(toRankedSummary)
}
