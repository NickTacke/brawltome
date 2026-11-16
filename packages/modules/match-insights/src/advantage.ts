import { ADVANTAGE_SAMPLE_MS, ADVANTAGE_STOCK_DAMAGE, type Stock } from '@brawltome/contracts'

// who is ahead over the match, from stocks and damage alone: each side's stocks left minus the damage on the stock in
// play, as a share of a stock, against the other side's

export type Standing = { side: number; stocks: Stock[] }

function damageAt(stock: Stock, timeMs: number): number {
  return stock.tape.findLast(([atMs]) => atMs <= timeMs)?.[1] ?? 0
}

function standingAt(standing: Standing, stockCount: number, timeMs: number): number {
  const lost = standing.stocks.filter((stock) => stock.isKo && stock.endMs <= timeMs).length
  const current = standing.stocks.find((stock) => stock.startMs <= timeMs && timeMs < stock.endMs)
  const damage = current ? Math.min(damageAt(current, timeMs), ADVANTAGE_STOCK_DAMAGE) : 0

  if (lost >= stockCount) return 0

  return stockCount - lost - damage / ADVANTAGE_STOCK_DAMAGE
}

/** One side's standing minus the other side's, sampled along the match. */
export function readAdvantage(standings: Standing[], side: number, stockCount: number, durationMs: number): number[] {
  const sampleCount = Math.floor(durationMs / ADVANTAGE_SAMPLE_MS) + 1
  const times = Array.from({ length: sampleCount }, (_, index) => index * ADVANTAGE_SAMPLE_MS)

  return times.map((timeMs) =>
    standings.reduce((lead, standing) => {
      const value = standingAt(standing, stockCount, timeMs)

      return standing.side === side ? lead + value : lead - value
    }, 0),
  )
}
