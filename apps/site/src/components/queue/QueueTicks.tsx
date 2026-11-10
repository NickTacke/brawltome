import { tickCounts } from './queue-ticks'

type Tick = { key: string; style: string }

function ticksFor(wins: number, losses: number): Tick[] {
  const { winTicks, lossTicks } = tickCounts(wins, losses)
  const winRun = Array.from({ length: winTicks }, (_, index) => ({ key: `win-${index}`, style: 'bg-emerald-400/85' }))
  const lossRun = Array.from({ length: lossTicks }, (_, index) => ({ key: `loss-${index}`, style: 'bg-red-400/70' }))

  return [...winRun, ...lossRun]
}

/** Wins then losses, one tick each, beside the record it draws. The record itself is the text. */
export function QueueTicks({ wins, losses }: { wins: number; losses: number }) {
  return (
    <div className="flex h-2.5 w-[4.875rem] items-stretch gap-0.5" aria-hidden="true">
      {ticksFor(wins, losses).map((tick) => (
        <span key={tick.key} className={`w-[0.1875rem] rounded-[0.0625rem] ${tick.style}`} />
      ))}
    </div>
  )
}
