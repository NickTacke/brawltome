import type { Stock } from '@brawltome/contracts'
import { memo } from 'react'
import { formatDamage } from '../match-format'
import { damageColour } from '../match-styles'

// the game's tint goes too dark to read as text past this damage
const brightestTextDamage = 150

type StockLaneProps = { stocks: Stock[]; durationMs: number }

// one hard-edged band per change of damage, in the colour the game gives that much damage
function damageGradient(stock: Stock): string {
  const lengthMs = Math.max(stock.endMs - stock.startMs, 1)
  const shareOf = (timeMs: number) => (((timeMs - stock.startMs) / lengthMs) * 100).toFixed(2)

  const bands = stock.tape.slice(0, -1).map(([timeMs, damage], index) => {
    const nextMs = stock.tape[index + 1]?.[0] ?? stock.endMs

    return `${damageColour(damage)} ${shareOf(timeMs)}% ${shareOf(nextMs)}%`
  })

  return `linear-gradient(to right, ${bands.join(', ')})`
}

// the damage a lost stock went out at, over its end; hidden on a stock too short to hold it, the readout has them all
function KoDamage({ stock }: { stock: Stock }) {
  return (
    <span
      className="pointer-events-none absolute top-0 right-0.5 hidden text-[0.6875rem] leading-3 font-black tabular-nums @[1.75rem]:block"
      style={{ color: damageColour(Math.min(stock.damageTaken, brightestTextDamage)) }}
    >
      {formatDamage(stock.damageTaken)}
    </span>
  )
}

/**
 * One player's match along the timeline: a round bar per stock that reddens as they take damage, in the colours the
 * game gives it. A lost stock carries the damage they went out at over its end.
 */
export const StockLane = memo(function StockLane({ stocks, durationMs }: StockLaneProps) {
  return stocks.map((stock) => (
    <span
      key={stock.index}
      className="@container absolute inset-y-0"
      style={{
        left: `${(stock.startMs / durationMs) * 100}%`,
        width: `${((stock.endMs - stock.startMs) / durationMs) * 100}%`,
      }}
    >
      <span
        data-stock-bar
        className="absolute inset-x-0 bottom-0 h-2 rounded-full"
        style={{ background: damageGradient(stock) }}
      />
      {stock.isKo ? <KoDamage stock={stock} /> : null}
    </span>
  ))
})
