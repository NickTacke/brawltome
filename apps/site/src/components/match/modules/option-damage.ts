import type { Habit } from '@brawltome/contracts'

// largest remainder: every option rounds down, then the ones that lost the most to rounding get a point back until
// the rows add up to the rounded total
function roundToTotal(values: number[]): number[] {
  const floors = values.map(Math.floor)
  const total = Math.round(values.reduce((sum, value) => sum + value, 0))
  const missing = total - floors.reduce((sum, value) => sum + value, 0)
  const byRemainder = values.map((value, index) => ({ index, remainder: value - Math.floor(value) }))

  const raised = new Set(
    byRemainder
      .sort((left, right) => right.remainder - left.remainder)
      .slice(0, missing)
      .map((entry) => entry.index),
  )

  return floors.map((floor, index) => (raised.has(index) ? floor + 1 : floor))
}

/**
 * The damage each option's row shows, by option key. A habit counted in times adds its rows up to the damage in its
 * header; one counted in seconds names only the top option's damage there, so its rows round on their own.
 */
export function optionDamages(habit: Habit): Map<string, number> {
  const values = habit.options.map((option) => option.costDamage)
  const rounded = habit.unit === 'times' ? roundToTotal(values) : values.map(Math.round)

  return new Map(habit.options.map((option, index) => [option.key, rounded[index] ?? 0]))
}
