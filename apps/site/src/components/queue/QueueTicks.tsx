import { tickCounts } from './queue-ticks'

type Tick = { key: string; style: string }

function tickRun(count: number, kind: string, style: string): Tick[] {
  return Array.from({ length: count }, (_, index) => ({ key: `${kind}-${index}`, style }))
}

function ticksFor(wins: number, losses: number): Tick[] {
  const { winTicks, lossTicks } = tickCounts(wins, losses)

  return [...tickRun(winTicks, 'win', 'bg-record-win/85'), ...tickRun(lossTicks, 'loss', 'bg-record-loss/70')]
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
