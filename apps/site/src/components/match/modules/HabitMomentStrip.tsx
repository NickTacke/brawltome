import type { Habit, HabitMoment } from '@brawltome/contracts'
import { formatClock } from '../match-format'
import { useWatch } from '../watch-moment'

function momentStyle(moment: HabitMoment, topKey: string | undefined): string {
  if (moment.costDamage > 0) return 'h-full bg-red-400'

  return moment.option === topKey ? 'h-3/5 bg-primary/80' : 'h-3/5 bg-white/[0.22]'
}

/** Every time the situation came up, along the match: tall and red when it was punished. A press plays it. */
export function HabitMomentStrip({ habit, durationMs }: { habit: Habit; durationMs: number }) {
  const watch = useWatch()

  if (habit.moments.length === 0) return null

  const optionLabel = (key: string) => habit.options.find((option) => option.key === key)?.label ?? ''

  return (
    <div>
      <div className="relative h-5 border-b border-line/40">
        {habit.moments.map((moment) => (
          <button
            key={`${moment.timeMs}-${moment.option}`}
            type="button"
            title={`${formatClock(moment.timeMs)} · ${optionLabel(moment.option)}`}
            onClick={() => watch?.(moment.timeMs)}
            className={`absolute bottom-0 w-[0.1875rem] -translate-x-1/2 rounded-t-[0.125rem] ${watch ? 'cursor-pointer hover:brightness-150' : ''} ${momentStyle(moment, habit.top?.key)}`}
            style={{ left: `${(moment.timeMs / durationMs) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.6875rem] text-soft/70">
        <span>0:00</span>
        <span>{formatClock(durationMs)}</span>
      </div>
    </div>
  )
}
