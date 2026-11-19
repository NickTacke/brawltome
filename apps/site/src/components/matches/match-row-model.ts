import type { MatchSummaryContract } from '@brawltome/contracts'

// what one row of a match list shows: two sides with a score between them, or a free for all in place order, and
// how the match went for the visitor when they played in it

export type RowPlayer = MatchSummaryContract['players'][number]

export type RowResult = { kind: 'won' } | { kind: 'lost' } | { kind: 'draw' } | { kind: 'place'; place: number }

export type RowView =
  | { kind: 'versus'; first: RowPlayer[]; second: RowPlayer[]; firstScore: number; secondScore: number }
  | { kind: 'freeForAll'; placed: RowPlayer[] }

function sidesOf(match: MatchSummaryContract): RowPlayer[][] {
  const bySide = new Map<number, RowPlayer[]>()

  for (const player of match.players) {
    const side = match.hasTeams ? player.team : player.slot

    bySide.set(side, [...(bySide.get(side) ?? []), player])
  }

  return [...bySide.values()]
}

function fallsOf(side: RowPlayer[]): number {
  return side.reduce((total, player) => total + player.deaths, 0)
}

// a timed match is placed by score, a stock match by who fell least
function placeOrder(left: RowPlayer, right: RowPlayer): number {
  if (left.score !== null && right.score !== null) return right.score - left.score

  return left.deaths - right.deaths || right.kos - left.kos
}

/** The row's layout: the visitor's side first in a match they played, the winners first otherwise. */
export function rowViewOf(match: MatchSummaryContract, yourId: number | null): RowView {
  const sides = sidesOf(match)

  if (sides.length !== 2) return { kind: 'freeForAll', placed: [...match.players].sort(placeOrder) }

  const isYours = (side: RowPlayer[]) => side.some((player) => player.brawlhallaId === yourId)
  const isWinning = (side: RowPlayer[]) => side.some((player) => player.isWinner)
  const leadsFirst = (side: RowPlayer[]) => (yourId !== null && sides.some(isYours) ? isYours(side) : isWinning(side))
  const [first, second] = leadsFirst(sides[0] ?? []) ? sides : [...sides].reverse()

  // a side scores the stocks the other side lost, the same count that decides the winner
  return {
    kind: 'versus',
    first: first ?? [],
    second: second ?? [],
    firstScore: fallsOf(second ?? []),
    secondScore: fallsOf(first ?? []),
  }
}

/** How the match went for the player with this id; null when they weren't in it. */
export function resultFor(match: MatchSummaryContract, yourId: number | null): RowResult | null {
  const you = match.players.find((player) => player.brawlhallaId === yourId)

  if (!you) return null

  const view = rowViewOf(match, yourId)

  if (view.kind === 'freeForAll') return { kind: 'place', place: view.placed.indexOf(you) + 1 }

  const bothWon = view.second.some((player) => player.isWinner) && you.isWinner

  if (bothWon) return { kind: 'draw' }

  return you.isWinner ? { kind: 'won' } : { kind: 'lost' }
}

/** The queue and size as players say it: `Ranked 2v2`, `Custom FFA`. */
export function queueLabel(match: MatchSummaryContract): string {
  const sides = sidesOf(match)
  const size = sides.length === 2 ? `${sides[0]?.length ?? 1}v${sides[1]?.length ?? 1}` : 'FFA'

  if (match.isRanked) return `Ranked ${size}`

  return match.queue === 'unranked' ? `Unranked ${size}` : `Custom ${size}`
}

/** `1st`, `2nd`, `3rd`, `4th` */
export function ordinal(place: number): string {
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }

  return `${place}${suffixes[place] ?? 'th'}`
}

/** How long ago, as short as a list can show it: `now`, `12m`, `2h`, `3d`, `5w`. */
export function shortAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)

  if (minutes < 1) return 'now'

  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)

  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}
