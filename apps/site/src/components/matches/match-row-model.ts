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

function isTimed(match: MatchSummaryContract): boolean {
  return match.players.length > 0 && match.players.every((player) => player.score !== null)
}

function total(side: RowPlayer[], pick: (player: RowPlayer) => number): number {
  return side.reduce((sum, player) => sum + pick(player), 0)
}

// the winners first, then a timed match by score and a stock match by who fell least. the summary doesn't say when
// a stocked-out player went out, so two who lost every stock are told apart by their KOs
function placeOrder(left: RowPlayer, right: RowPlayer): number {
  const byWin = Number(right.isWinner) - Number(left.isWinner)

  if (byWin !== 0) return byWin

  if (left.score !== null && right.score !== null) return right.score - left.score

  return left.deaths - right.deaths || right.kos - left.kos
}

/** A player's place in a free for all: one more than the players strictly ahead, so a tie shares a place. */
export function placeOf(players: RowPlayer[], player: RowPlayer): number {
  return 1 + players.filter((other) => placeOrder(other, player) < 0).length
}

/** The row's layout: the visitor's side first in a match they played, the winners first otherwise. */
export function rowViewOf(match: MatchSummaryContract, yourId: number | null): RowView {
  const sides = sidesOf(match)

  if (sides.length !== 2) return { kind: 'freeForAll', placed: [...match.players].sort(placeOrder) }

  const isYours = (side: RowPlayer[]) => side.some((player) => player.brawlhallaId === yourId)
  const isWinning = (side: RowPlayer[]) => side.some((player) => player.isWinner)
  const leadsFirst = (side: RowPlayer[]) => (yourId !== null && sides.some(isYours) ? isYours(side) : isWinning(side))
  const [first, second] = leadsFirst(sides[0] ?? []) ? sides : [...sides].reverse()

  const firstSide = first ?? []
  const secondSide = second ?? []

  // the same count that decides the winner: a timed match's score, or in a stock match the stocks the other side lost
  if (isTimed(match)) {
    const score = (player: RowPlayer) => player.score ?? 0

    return {
      kind: 'versus',
      first: firstSide,
      second: secondSide,
      firstScore: total(firstSide, score),
      secondScore: total(secondSide, score),
    }
  }

  const falls = (player: RowPlayer) => player.deaths

  return {
    kind: 'versus',
    first: firstSide,
    second: secondSide,
    firstScore: total(secondSide, falls),
    secondScore: total(firstSide, falls),
  }
}

/** How the match went for the player with this id; null when they weren't in it. */
export function resultFor(match: MatchSummaryContract, yourId: number | null): RowResult | null {
  const you = match.players.find((player) => player.brawlhallaId === yourId)

  if (!you) return null

  const view = rowViewOf(match, yourId)

  if (view.kind === 'freeForAll') return { kind: 'place', place: placeOf(view.placed, you) }

  const bothWon = view.second.some((player) => player.isWinner) && you.isWinner

  if (bothWon) return { kind: 'draw' }

  return you.isWinner ? { kind: 'won' } : { kind: 'lost' }
}

/** The queue and size as players say it: `Ranked 2v2`, `Custom FFA`. */
export function queueLabel(match: MatchSummaryContract): string {
  const sides = sidesOf(match)
  const size = sides.length === 2 ? `${sides[0]?.length ?? 1}v${sides[1]?.length ?? 1}` : 'FFA'

  if (match.isRanked) return `Ranked ${size}`

  return match.isCustom ? `Custom ${size}` : `Unranked ${size}`
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
