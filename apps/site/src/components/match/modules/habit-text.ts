import type { Habit } from '@brawltome/contracts'
import { formatDamage } from '../match-format'

// too few moments to say anything about a player
const thinSample = 5

export function isThin(habit: Habit): boolean {
  return habit.unit === 'times' && habit.total < thinSample
}

/** A habit's colours: red, as for what went against a player, when it is one to watch; faint on too few moments. */
export function accentOf(habit: Habit): { text: string; bar: string; colour: string } {
  if (habit.isFlagged) return { text: 'text-red-400', bar: 'bg-red-400', colour: 'var(--color-red-400)' }

  if (isThin(habit)) return { text: 'text-soft', bar: 'bg-soft/60', colour: 'var(--color-soft)' }

  return { text: 'text-strong', bar: 'bg-primary', colour: 'var(--color-primary)' }
}

export function sampleText(habit: Habit): string {
  if (habit.unit === 'seconds') return `${habit.top?.count ?? 0} s of ${habit.total} s`

  return `${habit.top?.count ?? 0} of ${habit.total}`
}

export function costText(habit: Habit): string {
  if (habit.unit === 'seconds') return `${habit.punished} hits taken`

  return habit.punished === 0 ? 'never punished' : `${habit.punished} punished`
}

export function damageText(habit: Habit): string {
  return `${formatDamage(habit.costDamage)} damage taken after`
}

/** The one line under a habit in its hover card: how often it came up, and how often it went wrong. */
export function cardCaption(habit: Habit): string {
  if (habit.unit === 'seconds') return `${habit.punished} hits taken up there`

  const times = `${habit.total} ${habit.total === 1 ? 'time' : 'times'}`

  return habit.punished === 0 ? times : `${times} · ${habit.punished} punished`
}
