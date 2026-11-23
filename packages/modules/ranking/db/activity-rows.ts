import type { Sql } from '@brawltome/foundation'
import type { RecentActivityEntry } from '../leaderboard'
import type { RegionalLeaderboardScope } from '../v1-leaderboard-source'
import { rowsByRating } from './rows-by-rating'
import { publishedIdentity, type StoredIdentityRow } from './stored-identity'

export type ActivityRow = StoredIdentityRow & {
  standing: number
  region: RegionalLeaderboardScope
  rating: number
  rating_delta: number
  wins_delta: number
  losses_delta: number
  games_delta: number
}

/** The two snapshots of one board an hour apart, and the regional boards either one carried from an earlier scan. */
export type ComparedSnapshots = {
  currentSnapshotId: string
  previousSnapshotId: string
  carriedSnapshotIds: readonly string[]
}

/** The columns of an ActivityRow, read from `current` and `previous` rows joined by playedRows. */
export function activityColumns(sql: Sql) {
  return sql`
    current.rating_standing AS standing, current.identity_kind, current.player_one_id, current.player_one_name,
    current.player_two_id, current.player_two_name, current.region, current.rating,
    current.identity_key,
    current.rating - previous.rating AS rating_delta,
    current.wins - previous.wins AS wins_delta,
    current.losses - previous.losses AS losses_delta,
    (current.wins + current.losses) - (previous.wins + previous.losses) AS games_delta
  `
}

// a row whose counters went down was reset, and one with only a rating change played no game we can count. a player
// listed on a carried board is left out, whichever board their global row came from
export function playedRows(sql: Sql, compared: ComparedSnapshots) {
  const { currentSnapshotId, previousSnapshotId, carriedSnapshotIds } = compared

  return sql`
    FROM (${rowsByRating(sql, currentSnapshotId)}) current
    JOIN rankings.snapshot_rows previous
      ON previous.snapshot_id = ${previousSnapshotId}
     AND previous.identity_key = current.identity_key
    WHERE current.wins >= previous.wins
      AND current.losses >= previous.losses
      AND current.wins + current.losses > previous.wins + previous.losses
      AND NOT EXISTS (
        SELECT 1
        FROM rankings.snapshot_rows carried
        WHERE carried.snapshot_id = ANY(${[...carriedSnapshotIds]}::uuid[])
          AND carried.identity_key = current.identity_key
      )
  `
}

export function activityEntry(row: ActivityRow): RecentActivityEntry {
  return {
    standing: row.standing,
    identity: publishedIdentity(row),
    region: row.region,
    rating: row.rating,
    ratingDelta: row.rating_delta,
    winsDelta: row.wins_delta,
    lossesDelta: row.losses_delta,
    gamesDelta: row.games_delta,
  }
}
