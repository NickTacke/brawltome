import type { BoardMode, BoardRegion } from '../components/home/home-filters'
import { pickRegion } from '../components/home/region-cookie'
import { loadLeaderboardPage } from './load-leaderboard-page'

export type LeaderboardRequest = { mode: BoardMode; region?: BoardRegion; page: number }

/** The board this visitor asked for, in the region they picked last time when the address names none. */
export async function leaderboardForVisitor(request: LeaderboardRequest, rememberedRegion: string | undefined) {
  const region = pickRegion(request.region, rememberedRegion)
  const board = await loadLeaderboardPage({ mode: request.mode, region, page: request.page })

  return { region, board }
}
