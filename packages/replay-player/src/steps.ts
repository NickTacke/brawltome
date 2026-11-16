// Reads a line's [step, ...] lists, which hold each change at the step it happened, in order

// lastAt is the index of the last [step, ...] entry at or before step, or -1
export function lastAt(list: readonly (readonly [number, ...unknown[]])[], step: number): number {
  let low = 0
  let high = list.length - 1
  let found = -1

  while (low <= high) {
    const middle = (low + high) >> 1

    if (list[middle][0] <= step) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }

  return found
}

// valueAt is the value of the last [step, value] entry at or before step
export function valueAt<T>(list: [number, T][] | undefined, step: number): T | undefined {
  if (!list) return undefined

  const index = lastAt(list, step)

  return index < 0 ? undefined : list[index][1]
}
