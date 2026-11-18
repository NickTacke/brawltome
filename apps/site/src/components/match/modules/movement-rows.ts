import type { MatchPlayer } from '../match-players'
import type { NumberRow } from '../number-rows'

// a count where more is only more, not better: shown, never pointed out
function countRow(label: string, count: (player: MatchPlayer) => number): NumberRow {
  return { label, value: (player) => String(count(player)), score: count }
}

/** How each player moved, from the game's counters and the line read beside them. */
export const movementRows: NumberRow[] = [
  countRow('Dashes', ({ extras }) => extras.dashes),
  countRow('Jumps', ({ extras }) => extras.jumps),
  countRow('Air jumps', ({ extras }) => extras.airJumps),
  countRow('Dash jumps', ({ extras }) => extras.dashJumps),
  countRow('Dodges', ({ player }) => player.dodges),
  countRow('Chase dodges', ({ insight }) => insight.oddities.chaseDodges),
  countRow('Gravity cancels', ({ insight }) => insight.oddities.gravityCancels),
  {
    label: 'Longest airtime',
    value: ({ insight }) => `${(insight.oddities.longestAirMs / 1000).toFixed(1)}s`,
    score: ({ insight }) => insight.oddities.longestAirMs,
  },
  {
    label: 'Inputs / minute',
    value: ({ extras }) => String(Math.round(extras.inputsPerMinute)),
    score: ({ extras }) => extras.inputsPerMinute,
  },
  {
    label: 'Hitstun mashing',
    value: ({ insight }) => `${insight.oddities.mashPerSecond.toFixed(1)}/s`,
    score: ({ insight }) => insight.oddities.mashPerSecond,
  },
  {
    label: 'Throws landed',
    value: ({ insight, extras }) => `${insight.oddities.throwsHit}/${extras.throws}`,
    score: ({ insight }) => insight.oddities.throwsHit,
  },
  countRow('Weapon pickups', ({ extras }) => extras.pickups),
]
