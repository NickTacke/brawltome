import type { Habit } from '@brawltome/contracts'
import { statLabel } from '../../player/player-styles'

const faintestShare = 0.08

/** Nine cells for the nine ways to dodge: towards the enemy on the left, away on the right, spot in the middle. */
export function DirectionPad({ habit, accent }: { habit: Habit; accent: string }) {
  const most = Math.max(1, ...habit.options.map((option) => option.count))

  const cells = habit.options.map((option) => {
    const strength = option.count === 0 ? faintestShare : 0.25 + 0.75 * (option.count / most)
    const colour = option.count === 0 ? 'var(--color-strong)' : accent

    return (
      <span
        key={option.key}
        title={`${option.label}: ${option.count}`}
        className="flex aspect-square items-center justify-center rounded-md text-xs font-black text-ink tabular-nums"
        style={{ backgroundColor: `color-mix(in srgb, ${colour} ${Math.round(strength * 100)}%, transparent)` }}
      >
        {option.count > 0 ? option.count : ''}
      </span>
    )
  })

  return (
    <div className="w-28 shrink-0">
      <div className="grid grid-cols-3 gap-1" role="img" aria-label={`${habit.top?.label ?? 'No dodge'} most often`}>
        {cells}
      </div>
      <div className={`mt-1.5 flex justify-between ${statLabel}`}>
        <span>In</span>
        <span>Away</span>
      </div>
    </div>
  )
}
