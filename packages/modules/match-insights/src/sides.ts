import { type MatchRecord, sideOf, statsOf } from './record'

// who won: the side that fell least, as the game's own score is missing from ranked replays

export type SideResult = { fallsBySide: Map<number, number>; fewestFalls: number }

export function readSideResult(record: MatchRecord): SideResult {
  const fallsBySide = new Map<number, number>()

  for (const player of record.players) {
    const side = sideOf(record, player.slot)

    fallsBySide.set(side, (fallsBySide.get(side) ?? 0) + statsOf(record, player.slot).Deaths)
  }

  return { fallsBySide, fewestFalls: Math.min(...fallsBySide.values()) }
}

export function isWinningSide(result: SideResult, side: number): boolean {
  return result.fallsBySide.get(side) === result.fewestFalls
}
