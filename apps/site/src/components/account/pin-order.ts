/**
 * The whole stored order after moving one pin a step among the pins other than the verified account, or null when it
 * can't move. The verified account keeps its stored place, because the api refuses an order that moves it.
 */
export function movePin(pinOrder: number[], verifiedId: number | null, movedId: number, step: -1 | 1): number[] | null {
  if (movedId === verifiedId) return null

  const otherPins = pinOrder.filter((brawlhallaId) => brawlhallaId !== verifiedId)
  const fromIndex = otherPins.indexOf(movedId)
  const toIndex = fromIndex + step

  if (fromIndex === -1 || toIndex < 0 || toIndex >= otherPins.length) return null

  otherPins.splice(fromIndex, 1)
  otherPins.splice(toIndex, 0, movedId)

  const verifiedIndex = verifiedId === null ? -1 : pinOrder.indexOf(verifiedId)

  if (verifiedId !== null && verifiedIndex !== -1) otherPins.splice(verifiedIndex, 0, verifiedId)

  return otherPins
}

/** The rows in the order the api answered, leaving out any id without a row. */
export function orderRows<T extends { brawlhallaId: number }>(rows: T[], pinOrder: number[]): T[] {
  const rowsById = new Map(rows.map((row) => [row.brawlhallaId, row]))

  return pinOrder.flatMap((brawlhallaId) => rowsById.get(brawlhallaId) ?? [])
}
