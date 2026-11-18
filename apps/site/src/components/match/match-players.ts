import type { MatchInsights, PlayerExtras, PlayerInsight, SummaryPlayer } from '@brawltome/contracts'
import { comparePlayers } from './review/lane-players'

// a player of the match with everything the page knows about them: the game's counters, the loadout and movement
// read beside them, and their insights
export type MatchPlayer = { slot: number; player: SummaryPlayer; extras: PlayerExtras; insight: PlayerInsight }

function readMatchPlayer(insights: MatchInsights, player: SummaryPlayer): MatchPlayer {
  const extras = insights.extras.players.find((entry) => entry.slot === player.slot)
  const insight = insights.insights.players.find((entry) => entry.slot === player.slot)

  if (!extras || !insight) throw new Error(`read match players: no insights for slot ${player.slot}`)

  return { slot: player.slot, player, extras, insight }
}

/** The players in the page's order: winners first, then by side and slot, as along the timeline. */
export function matchPlayersOf(insights: MatchInsights): MatchPlayer[] {
  const ordered = [...insights.summary.players].sort(comparePlayers)

  return ordered.map((player) => readMatchPlayer(insights, player))
}

/** True for a player who starts another side than the one before them, who gets a little air in a team match. */
export function startsNewSide(players: MatchPlayer[], index: number): boolean {
  const player = players[index]
  const before = players[index - 1]

  return player !== undefined && before !== undefined && player.player.side !== before.player.side
}
