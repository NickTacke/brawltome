import { type Leaderboard1v1Output, parseLeaderboard1v1Output } from '@brawltome/contracts'
import type { Leaderboard1v1View } from '@brawltome/ranking'

export function mapLeaderboard1v1Output(view: Leaderboard1v1View): Leaderboard1v1Output {
  return parseLeaderboard1v1Output(view)
}
