import type { MatchPlayer } from './match-players'

// a row of a table of players' numbers. score and better let the table point out who leads it; rows without them are
// only shown
export type NumberRow = {
  label: string
  value: (player: MatchPlayer) => string
  score?: (player: MatchPlayer) => number | null
  better?: 'high' | 'low'
}

/** The slots that lead a row, when the row says which way is better and the players differ. */
export function leadersOf(row: NumberRow, players: MatchPlayer[]): Set<number> {
  const scored = players.map((player) => ({ slot: player.slot, score: row.score?.(player) ?? null }))
  const scores = scored.map((entry) => entry.score).filter((score): score is number => score !== null)

  if (!row.better || scores.length < 2 || new Set(scores).size === 1) return new Set()

  const best = row.better === 'high' ? Math.max(...scores) : Math.min(...scores)

  return new Set(scored.filter((entry) => entry.score === best).map((entry) => entry.slot))
}
