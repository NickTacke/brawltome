/** Orders patch names like `11.01`, `11.00`, `10.09` newest first; a part that isn't a number counts as 0. */
export function comparePatchesNewestFirst(left: string, right: string): number {
  const leftParts = left.split('.').map(toNumber)
  const rightParts = right.split('.').map(toNumber)

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)

    if (difference !== 0) return difference
  }

  return 0
}

function toNumber(part: string): number {
  const value = Number.parseInt(part, 10)

  return Number.isNaN(value) ? 0 : value
}
