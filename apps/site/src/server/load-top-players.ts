import { type LeaderboardEntry, leaderboardOutputSchema } from '@brawltome/contracts'
import type { BoardMode, BoardRegion } from '../components/home/home-filters'
import { readApi } from './api'
import { readOptional } from './optional-read'

const topPlayerCount = 5

async function readTopPlayers(mode: BoardMode, region: BoardRegion): Promise<LeaderboardEntry[]> {
  const description = `load top players for ${mode} ${region}`
  const board = await readApi(`/leaderboards/${mode}/${region}?page=1`, leaderboardOutputSchema, description)

  // a board that isn't published yet has nobody on it, same as an empty one
  if (board.status === 'unavailable') return []

  return board.entries.slice(0, topPlayerCount)
}

/** The top of one board, or null when it couldn't be read, so the rest of Home can still show. */
export function loadTopPlayers(mode: BoardMode, region: BoardRegion): Promise<LeaderboardEntry[] | null> {
  return readOptional(() => readTopPlayers(mode, region), null)
}
