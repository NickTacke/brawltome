import type { Series } from './line'

// the timeline keeps each player's state as change lists: [step, value from then on], in step order

/** The value a change list holds at a step: the last change at or before it. */
export function valueAt<Value>(series: Series<Value>, step: number, fallback: Value): Value {
  let low = 0
  let high = series.length - 1
  let found = -1

  while (low <= high) {
    const middle = (low + high) >> 1

    if ((series[middle]?.[0] ?? Number.POSITIVE_INFINITY) <= step) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return found < 0 ? fallback : (series[found]?.[1] ?? fallback)
}

/** The steps at which a change list switched to the given value; its first entry is where it starts, not a switch. */
export function stepsWhereBecame<Value>(series: Series<Value>, value: Value): number[] {
  return series.flatMap(([step, current], index) => (index > 0 && current === value ? [step] : []))
}

/** The last step in [from, to] at which the list switched to the value, or null. */
export function lastBecameWithin<Value>(series: Series<Value>, value: Value, from: number, to: number): number | null {
  let found: number | null = null

  for (const [step, current] of series) {
    if (step > to) break

    if (step >= from && current === value) found = step
  }

  return found
}
