// who won a stored match, from the players' own lines. a stock match goes to the side that fell least, the rule the
// match page's insights use; a timed match to the side that scored most, since every timed line has its score

export type ResultLine = { slot: number; team: number; deaths: number; score: number | null }

/** The team in a team match, the player's own slot otherwise. */
export function sideOf(line: ResultLine, hasTeams: boolean): number {
  return hasTeams ? line.team : line.slot
}

/** The slots on the winning side; a tie leaves more than one side winning. */
export function winningSlots(lines: ResultLine[], hasTeams: boolean): Set<number> {
  const isTimed = lines.length > 0 && lines.every((line) => line.score !== null)
  const totals = new Map<number, number>()

  for (const line of lines) {
    const side = sideOf(line, hasTeams)
    const amount = isTimed ? (line.score ?? 0) : line.deaths

    totals.set(side, (totals.get(side) ?? 0) + amount)
  }

  const values = [...totals.values()]
  const best = isTimed ? Math.max(...values) : Math.min(...values)

  const winners = lines.filter((line) => totals.get(sideOf(line, hasTeams)) === best)

  return new Set(winners.map((line) => line.slot))
}
