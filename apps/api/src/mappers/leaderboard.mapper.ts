import { type LeaderboardOutput, parseLeaderboardOutput } from '@brawltome/contracts'
import type { LeaderboardView } from '@brawltome/ranking'

export function mapLeaderboardOutput(view: LeaderboardView): LeaderboardOutput {
  return parseLeaderboardOutput(view)
}
