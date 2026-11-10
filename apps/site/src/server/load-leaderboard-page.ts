import { type LeaderboardEntry, leaderboardOutputSchema } from '@brawltome/contracts'
import type { BoardMode, BoardRegion } from '../components/home/home-filters'
import type { RankedPage } from '../components/ranked-page'
import { readApi } from './api'
import { readOptional } from './optional-read'

export type LeaderboardQuery = { mode: BoardMode; region: BoardRegion; page: number }

async function readLeaderboardPage({ mode, region, page }: LeaderboardQuery): Promise<RankedPage<LeaderboardEntry>> {
  const description = `load leaderboard page ${page} for ${mode} ${region}`
  const board = await readApi(`/leaderboards/${mode}/${region}?page=${page}`, leaderboardOutputSchema, description)

  // a board that isn't published yet has nobody on it, same as an empty one
  if (board.status === 'unavailable') return { entries: [], totalRows: 0, pageSize: board.pageSize }

  return { entries: board.entries, totalRows: board.totalRows, pageSize: board.pageSize }
}

/** One page of a board, or null when it couldn't be read, so the page can still show its filters. */
export function loadLeaderboardPage(query: LeaderboardQuery): Promise<RankedPage<LeaderboardEntry> | null> {
  return readOptional(() => readLeaderboardPage(query), null)
}
