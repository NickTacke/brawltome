import type { Sql } from '@brawltome/foundation'
import type { LeaderboardScope } from '../leaderboard'
import type { RegionalLeaderboardScope } from '../v1-leaderboard-source'
import { rowsByRating } from './rows-by-rating'

export type PlayerBoardRanks = { globalRank: number | null; regionRank: number | null }

type PlacedOn = { scope: LeaderboardScope; rating_standing: number }

/**
 * A player's place on the latest published 1v1 board of each scope asked for. The board is picked as the leaderboard
 * page picks it and ranked by the same rowsByRating, so both show one number. A board the player is not on gives no
 * row.
 */
async function readPlaces(sql: Sql, brawlhallaId: number, scopes: LeaderboardScope[]): Promise<PlacedOn[]> {
  return sql<PlacedOn[]>`
    SELECT board.scope, ranked.rating_standing
    FROM unnest(${scopes}::text[]) AS asked(scope)
    CROSS JOIN LATERAL (
      SELECT snapshot.id, snapshot.scope
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
    WHERE ranked.player_one_id = ${brawlhallaId}
  `
}

function placeOn(places: PlacedOn[], scope: LeaderboardScope): number | null {
  const place = places.find((placed) => placed.scope === scope)

  return place?.rating_standing ?? null
}

/** Where a player stands on the global 1v1 board and on the board of `region`, null for a board they are not on. */
export async function readPlayerBoardRanks(
  sql: Sql,
  input: { brawlhallaId: number; region: RegionalLeaderboardScope | null },
): Promise<PlayerBoardRanks> {
  const { brawlhallaId, region } = input
  const scopes: LeaderboardScope[] = region ? ['all', region] : ['all']
  const places = await readPlaces(sql, brawlhallaId, scopes)

  return { globalRank: placeOn(places, 'all'), regionRank: region ? placeOn(places, region) : null }
}
