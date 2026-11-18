import type { Habit } from '@brawltome/contracts'
import { statLabel } from '../../player/player-styles'
import { formatShare } from '../match-format'
import { accentOf } from './habit-text'
import { optionDamages } from './option-damage'

// narrower on a phone, where the panel is as wide as the screen
const optionColumns =
  'grid grid-cols-[minmax(4rem,1fr)_2.5rem_2.75rem_4.75rem_3.25rem] gap-x-2 sm:grid-cols-[minmax(5rem,1fr)_3rem_3rem_4.5rem_3.5rem] sm:gap-x-3'

/** Every option the player picked in the situation, most picked first, with what each cost them. */
export function HabitOptionRows({ habit }: { habit: Habit }) {
  const used = habit.options.filter((option) => option.count > 0).sort((left, right) => right.count - left.count)
  const accent = accentOf(habit)
  const isSeconds = habit.unit === 'seconds'
  const damages = optionDamages(habit)

  return (
    <div className="min-w-0">
      <div className={`${optionColumns} pb-1 ${statLabel}`}>
        <span>Option</span>
        <span className="text-right">{isSeconds ? 'Secs' : 'Times'}</span>
        <span className="text-right">Share</span>
        <span className="text-right">{isSeconds ? 'Hits taken' : 'Punished'}</span>
        <span className="text-right">Damage</span>
      </div>
      {used.map((option) => (
        // on a phone a long option wraps and its row grows, as five columns leave its name little room
        <div key={option.key} className={`${optionColumns} min-h-7 items-center border-t border-line/30 text-sm`}>
          <span
            className={`truncate font-semibold phone:py-1 phone:leading-tight phone:whitespace-normal ${option.key === habit.top?.key ? accent.text : 'text-text'}`}
          >
            {option.label}
          </span>
          <span className="text-right font-mono text-soft">{option.count}</span>
          <span className="text-right font-black tracking-tight text-strong tabular-nums">
            {formatShare(option.count / habit.total)}
          </span>
          <span className="text-right font-mono text-soft">{option.punished}</span>
          <span className="text-right font-mono text-soft">{damages.get(option.key)}</span>
        </div>
      ))}
    </div>
  )
}
