import { ADVANTAGE_SAMPLE_MS, ADVANTAGE_STOCK_DAMAGE, type Stock } from '@brawltome/contracts'

// who is ahead over the match, from stocks and damage alone: each side's stocks left minus the damage on the stock in
// play, as a share of a stock, against the other side's

// a stock still in play is never worth nothing, however deep in damage, so a side with a player left stays ahead of
// one without
const mostSpentShare = 0.95

export type Standing = { side: number; stocks: Stock[] }

function damageAt(stock: Stock, timeMs: number): number {
  return stock.tape.findLast(([atMs]) => atMs <= timeMs)?.[1] ?? 0
}

// the last stock of a player still in play at the end runs up to and including the end
function isInPlay(stock: Stock, timeMs: number): boolean {
  const isBeforeEnd = timeMs < stock.endMs || (!stock.isKo && timeMs === stock.endMs)

  return stock.startMs <= timeMs && isBeforeEnd
}

function standingAt(standing: Standing, stockCount: number, timeMs: number): number {
  const lost = standing.stocks.filter((stock) => stock.isKo && stock.endMs <= timeMs).length
  const current = standing.stocks.find((stock) => isInPlay(stock, timeMs))
  const damage = current ? damageAt(current, timeMs) : 0
  const spent = Math.min(damage / ADVANTAGE_STOCK_DAMAGE, mostSpentShare)

  if (lost >= stockCount) return 0

  return stockCount - lost - spent
}

// every sample interval from the start, and the end itself, after the last KO, when it falls between two
function sampleTimes(durationMs: number): number[] {
  const sampleCount = Math.floor(durationMs / ADVANTAGE_SAMPLE_MS) + 1
  const times = Array.from({ length: sampleCount }, (_, index) => index * ADVANTAGE_SAMPLE_MS)

  return times.at(-1) === durationMs ? times : [...times, durationMs]
}

/** One side's standing minus the other side's, sampled along the match. */
export function readAdvantage(standings: Standing[], side: number, stockCount: number, durationMs: number): number[] {
  return sampleTimes(durationMs).map((timeMs) =>
    standings.reduce((lead, standing) => {
      const value = standingAt(standing, stockCount, timeMs)

      return standing.side === side ? lead + value : lead - value
    }, 0),
  )
}
