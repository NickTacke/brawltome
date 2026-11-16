import type { Stock } from '@brawltome/contracts'
import { formatDamage } from '../match-format'

// what the readout over the lanes says about a time of the match. it reads the steps the game ran in, so it says
// what the timeline says at the step the pointer is in, never a mix of two steps

/** The time at a share of the timeline, at the start of the step it falls in. */
export function pointerTimeMs(share: number, durationMs: number, stepMs: number): number {
  const timeMs = Math.min(Math.max(share, 0), 1) * durationMs

  return Math.floor(timeMs / stepMs) * stepMs
}

// a life ends on the step the player goes out, which is no longer part of it; the last life lasts to the match's end
function isInLife(stock: Stock, timeMs: number): boolean {
  if (timeMs < stock.startMs) return false

  return stock.isKo ? timeMs < stock.endMs : timeMs <= stock.endMs
}

/** A player's damage at a time, or null while they are out of play. */
export function damageAt(stocks: Stock[], timeMs: number): number | null {
  const stock = stocks.find((entry) => isInLife(entry, timeMs))

  if (!stock) return null

  return stock.tape.findLast(([atMs]) => atMs <= timeMs)?.[1] ?? 0
}

/** A player's damage at a time as the readout writes it: a whole number, or a dash while they are out of play. */
export function damageText(stocks: Stock[], timeMs: number): string {
  const damage = damageAt(stocks, timeMs)

  return damage === null ? '–' : formatDamage(damage)
}
