import type { SeasonStartContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { type DailyGameCountDrops, detectSeasonStarts } from '../ranked/season-starts'

/** Season starts detected from the days stored game counts fell on. */
export async function readSeasonStarts(database: Database): Promise<SeasonStartContract[]> {
  const days = await database.sql<DailyGameCountDrops[]>`
    WITH ordered AS (
      SELECT recorded_at, games,
             lag(games) OVER (PARTITION BY brawlhalla_id ORDER BY recorded_at, id) AS previous_games
      FROM players.ranked_rating_history
    )
    SELECT to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE games < previous_games)::int AS drops,
           count(*)::int AS points
    FROM ordered
    GROUP BY 1
    ORDER BY 1
  `

  return detectSeasonStarts(days)
}
