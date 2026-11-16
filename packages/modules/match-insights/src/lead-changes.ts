import type { Knockout } from '@brawltome/contracts'

// a lead change is the stock lead passing from one side to another; level scores in between don't count

function leaderOf(falls: Map<number, number>): number | null {
  const [first, second] = [...falls.entries()].sort((left, right) => left[1] - right[1])

  if (!first || first[1] === second?.[1]) return null

  return first[0]
}

export function countLeadChanges(knockouts: Knockout[], sides: number[], sideOf: (slot: number) => number): number {
  const falls = new Map(sides.map((side) => [side, 0]))
  let leader: number | null = null
  let changes = 0

  for (const knockout of knockouts) {
    const side = sideOf(knockout.victim)

    falls.set(side, (falls.get(side) ?? 0) + 1)

    const ahead = leaderOf(falls)

    if (ahead === null) continue

    if (leader !== null && leader !== ahead) changes += 1

    leader = ahead
  }

  return changes
}
