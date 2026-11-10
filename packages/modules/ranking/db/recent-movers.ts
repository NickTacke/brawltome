import { leaderboardRecentMoverCount } from '@brawltome/contracts'
import type { Sql } from '@brawltome/foundation'
import type { RecentActivityEntry } from '../leaderboard'
import { type ActivityRow, activityColumns, activityEntry, type ComparedSnapshots, playedRows } from './activity-rows'

type MoverList = 'climbers' | 'drops' | 'most_games'
type MoverRow = ActivityRow & { list: MoverList }

export type RecentMovers = {
  climbers: RecentActivityEntry[]
  drops: RecentActivityEntry[]
  mostGames: RecentActivityEntry[]
}

function entriesOf(rows: MoverRow[], list: MoverList): RecentActivityEntry[] {
  return rows.filter((row) => row.list === list).map(activityEntry)
}

/**
 * Ranks everyone who played between the two snapshots, so a big climber further down the board still shows. Ties
 * go to the higher rating, then to the stored identity, so the lists never shuffle between reads.
 */
export async function readRecentMovers(sql: Sql, snapshots: ComparedSnapshots): Promise<RecentMovers> {
  const rows = await sql<MoverRow[]>`
    WITH played AS (
      SELECT ${activityColumns(sql)}
      ${playedRows(sql, snapshots)}
    ), ranked AS (
      SELECT 'climbers' AS list, played.*,
             row_number() OVER (ORDER BY rating_delta DESC, rating DESC, identity_key) AS place
      FROM played
      WHERE rating_delta > 0
      UNION ALL
      SELECT 'drops' AS list, played.*,
             row_number() OVER (ORDER BY rating_delta ASC, rating DESC, identity_key) AS place
      FROM played
      WHERE rating_delta < 0
      UNION ALL
      SELECT 'most_games' AS list, played.*,
             row_number() OVER (ORDER BY games_delta DESC, rating DESC, identity_key) AS place
      FROM played
    )
    SELECT *
    FROM ranked
    WHERE place <= ${leaderboardRecentMoverCount}
    ORDER BY list, place
  `

  return {
    climbers: entriesOf(rows, 'climbers'),
    drops: entriesOf(rows, 'drops'),
    mostGames: entriesOf(rows, 'most_games'),
  }
}
