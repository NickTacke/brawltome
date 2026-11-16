import { type LineHead, lineHeadSchema } from './line'

// the page only reads stock 1v1s and 2v2s with a timeline; anything else stays a plain match page

function isDuel(head: LineHead): boolean {
  const [first, second] = head.match.players

  return head.match.players.length === 2 && (!head.match.rules.hasTeams || first?.team !== second?.team)
}

function isDoubles(head: LineHead): boolean {
  const { players, rules } = head.match
  const teams = Map.groupBy(players, (player) => player.team)

  return (
    players.length === 4 && rules.hasTeams && teams.size === 2 && [...teams.values()].every((team) => team.length === 2)
  )
}

export function isInsightMatch(line: unknown): boolean {
  const head = lineHeadSchema.safeParse(line)

  if (!head.success || head.data.match.rules.mode.name !== 'Stock') return false

  return isDuel(head.data) || isDoubles(head.data)
}
