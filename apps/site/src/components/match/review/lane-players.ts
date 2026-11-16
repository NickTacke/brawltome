import type { MatchInsights, Stock, SummaryPlayer } from '@brawltome/contracts'

// a player of the timeline: who they are, and their lives along the match
export type LanePlayer = { player: SummaryPlayer; stocks: Stock[] }

function compareLanes(left: SummaryPlayer, right: SummaryPlayer): number {
  const byWinner = Number(right.isWinner) - Number(left.isWinner)

  return byWinner || left.side - right.side || left.slot - right.slot
}

/** The timeline's players, winners first, then by side and slot, so teammates lie next to each other. */
export function lanePlayersOf(insights: MatchInsights): LanePlayer[] {
  const players = [...insights.summary.players].sort(compareLanes)

  return players.map((player) => ({
    player,
    stocks: insights.insights.players.find((entry) => entry.slot === player.slot)?.stocks ?? [],
  }))
}

/** True for a lane that starts another side than the one above it, which gets a little air in a team match. */
export function startsSide(lanes: LanePlayer[], index: number): boolean {
  const lane = lanes[index]
  const above = lanes[index - 1]

  return lane !== undefined && above !== undefined && lane.player.side !== above.player.side
}
