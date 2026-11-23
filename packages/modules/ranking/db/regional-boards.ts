import type { Sql } from '@brawltome/foundation'
import type { PublishedLeaderboardRow, PublishedRegionalBoard } from '../leaderboard'
import type { LeaderboardMode, RegionalLeaderboardScope } from '../v1-leaderboard-source'
import { publishedIdentity, type StoredIdentityRow } from './stored-identity'

type LatestBoard = { snapshot_id: string; scope: RegionalLeaderboardScope; operation_key: string }

type BoardRow = StoredIdentityRow & {
  snapshot_id: string
  standing: number
  source_rank: number
  region: RegionalLeaderboardScope
  rating: number
  peak_rating: number | null
  wins: number
  losses: number
  tier: string | null
}

function publishedRow(row: BoardRow): PublishedLeaderboardRow {
  return {
    standing: row.standing,
    sourceRank: row.source_rank,
    identity: publishedIdentity(row),
    region: row.region,
    rating: row.rating,
    peakRating: row.peak_rating ?? row.rating,
    wins: row.wins,
    losses: row.losses,
    tier: row.tier,
  }
}

function readLatestBoards(sql: Sql, mode: LeaderboardMode) {
  return sql<LatestBoard[]>`
    SELECT DISTINCT ON (snapshot.scope) snapshot.id AS snapshot_id, snapshot.scope, generation.operation_key
    FROM rankings.snapshots snapshot
    JOIN rankings.generations generation
      ON generation.id = snapshot.generation_id AND generation.mode = snapshot.mode
    WHERE generation.finalized
      AND generation.source = 'brawlhalla-v1-ranked-leaderboard'
      AND snapshot.mode = ${mode}
      AND snapshot.scope <> 'all'
    ORDER BY snapshot.scope, generation.schedule_window_at DESC, generation.id DESC
  `
}

function readBoardRows(sql: Sql, mode: LeaderboardMode, snapshotIds: string[]) {
  return sql<BoardRow[]>`
    SELECT snapshot_id, standing, source_rank, identity_kind, player_one_id, player_one_name, player_two_id,
           player_two_name, region, rating, peak_rating, wins, losses, tier
    FROM rankings.snapshot_rows
    WHERE snapshot_id = ANY(${snapshotIds}::uuid[])
      AND mode = ${mode}
    ORDER BY snapshot_id, ordinal
  `
}

/**
 * The newest official board of every region of one mode, in its stored order. A scan reads them to skip the regions
 * its window already published, and to carry a region it cannot collect onto the global board.
 */
export async function readLatestRegionalBoards(
  sql: Sql,
  mode: LeaderboardMode,
): Promise<ReadonlyMap<RegionalLeaderboardScope, PublishedRegionalBoard>> {
  const latest = await readLatestBoards(sql, mode)
  const snapshotIds = latest.map(({ snapshot_id }) => snapshot_id)
  const rows = await readBoardRows(sql, mode, snapshotIds)
  const rowsBySnapshot = Map.groupBy(rows, ({ snapshot_id }) => snapshot_id)

  return new Map(
    latest.map((board) => {
      const boardRows = rowsBySnapshot.get(board.snapshot_id) ?? []

      return [board.scope, { operationKey: board.operation_key, rows: boardRows.map(publishedRow) }]
    }),
  )
}
