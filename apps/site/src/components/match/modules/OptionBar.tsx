import type { Habit } from '@brawltome/contracts'

/** A habit's options as one thin split bar, built like the win bar: the most picked option stands out. */
export function OptionBar({ habit, accentClass }: { habit: Habit; accentClass: string }) {
  const used = habit.options.filter((option) => option.count > 0).sort((left, right) => right.count - left.count)

  return (
    <div
      className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full"
      role="img"
      aria-label={`${habit.top?.label ?? 'Nothing'} most often`}
    >
      {used.length === 0 && <div className="flex-1 bg-white/[0.08]" />}
      {used.map((option) => (
        <div
          key={option.key}
          className={option.key === habit.top?.key ? accentClass : 'bg-white/[0.16]'}
          style={{ width: `${(option.count / habit.total) * 100}%` }}
        />
      ))}
    </div>
  )
}
