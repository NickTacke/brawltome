import type { MoveRow } from '@brawltome/contracts'

export type MoveSortKey = 'damage' | 'accuracy' | 'uses'

/** The share of a move's uses that landed, as the insights count them. */
export function landedShare(move: MoveRow): number {
  return move.uses > 0 ? move.usesLanded / move.uses : 0
}

const moveSorts: Record<MoveSortKey, { label: string; score: (move: MoveRow) => number }> = {
  damage: { label: 'Damage', score: (move) => move.damage },
  accuracy: { label: 'Accuracy', score: landedShare },
  uses: { label: 'Uses', score: (move) => move.uses },
}

export const moveSortOptions = (Object.keys(moveSorts) as MoveSortKey[]).map((value) => ({
  value,
  label: moveSorts[value].label,
}))

/** A player's moves that were used, best first by the sort. */
export function rankMoves(moves: MoveRow[], sort: MoveSortKey): MoveRow[] {
  const used = moves.filter((move) => move.uses > 0)
  const score = moveSorts[sort].score

  return used.sort((left, right) => score(right) - score(left))
}
