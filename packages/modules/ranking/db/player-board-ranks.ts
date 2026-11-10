import type { Sql } from '@brawltome/foundation'
import type { LeaderboardScope } from '../leaderboard'
import { leaderboardSourcePageSize, type RegionalLeaderboardScope } from '../v1-leaderboard-source'
import { rowsByRating } from './rows-by-rating'

export type PlayerBoardRanks = { globalRank: number | null; regionRank: number | null }

type PlacedOn = {
  scope: LeaderboardScope
  rating_standing: number
  rating: number
  // the rating of the last row brawlhalla lists, on a regional board the scan filled
  cut_off_rating: number | null
}

/**
 * A player's place on the latest published 1v1 board of each scope asked for. The board is picked as the leaderboard
 * page picks it and ranked by the same rowsByRating, so both show one number. A board the player is not on gives no
 * row.
 *
 * The scan filled a regional board when the last row Brawlhalla lists has the rank a full scan ends at. The row
 * count would not do: a full scan that drops a duplicate row comes up one short.
 */
async function readPlaces(sql: Sql, brawlhallaId: number, scopes: LeaderboardScope[]): Promise<PlacedOn[]> {
  return sql<PlacedOn[]>`
    SELECT board.scope, ranked.rating_standing, ranked.rating, last_listed.rating AS cut_off_rating
    FROM unnest(${scopes}::text[]) AS asked(scope)
    CROSS JOIN LATERAL (
      SELECT snapshot.id, snapshot.scope,
             generation.page_depth * ${leaderboardSourcePageSize}::integer AS full_scan_rows
      FROM rankings.snapshots snapshot
      JOIN rankings.generations generation
        ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
      WHERE generation.finalized
        AND snapshot.mode = '1v1'
        AND snapshot.scope = asked.scope
      ORDER BY generation.schedule_window_at DESC, generation.id DESC
      LIMIT 1
    ) board
    CROSS JOIN LATERAL (${rowsByRating(sql, sql`board.id`)}) ranked
    LEFT JOIN LATERAL (
      SELECT listed.source_rank, listed.rating
      FROM rankings.snapshot_rows listed
      WHERE listed.snapshot_id = board.id
        AND board.scope <> 'all'
      ORDER BY listed.source_rank DESC
      LIMIT 1
    ) last_listed ON last_listed.source_rank >= board.full_scan_rows
    WHERE ranked.player_one_id = ${brawlhallaId}
  `
}

function placeOn(places: PlacedOn[], scope: LeaderboardScope): PlacedOn | null {
  return places.find((place) => place.scope === scope) ?? null
}

// brawlhalla lists a block of players first, some of them rated far below the rest of the board, and then everyone
// else by rating down to the last row. so a board the scan filled holds every player rated at least as high as that
// last row and only a few of the players below it: a standing is exact down to that rating and says nothing under
// it. a board the scan did not fill lists its whole region, so every standing on it is exact
function regionRankOf(place: PlacedOn | null): number | null {
  if (!place) return null

  const isBelowCutOff = place.cut_off_rating !== null && place.rating < place.cut_off_rating

  return isBelowCutOff ? null : place.rating_standing
}

/**
 * Where a player stands on the global 1v1 board and on the board of `region`. Null for a board they are not on, and
 * for a place the board cannot vouch for.
 */
export async function readPlayerBoardRanks(
  sql: Sql,
  input: { brawlhallaId: number; region: RegionalLeaderboardScope | null },
): Promise<PlayerBoardRanks> {
  const { brawlhallaId, region } = input
  const scopes: LeaderboardScope[] = region ? ['all', region] : ['all']
  const places = await readPlaces(sql, brawlhallaId, scopes)
  const globalPlace = placeOn(places, 'all')
  const regionPlace = region ? placeOn(places, region) : null

  return { globalRank: globalPlace?.rating_standing ?? null, regionRank: regionRankOf(regionPlace) }
}
