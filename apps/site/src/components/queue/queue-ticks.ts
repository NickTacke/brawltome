export const maxTicks = 16

export type TickCounts = { winTicks: number; lossTicks: number }

/** One tick per game, scaled down to the cap for a long session, so the bar never outgrows its column. */
export function tickCounts(wins: number, losses: number): TickCounts {
  const games = wins + losses

  if (games <= maxTicks) return { winTicks: wins, lossTicks: losses }

  const scaledWins = Math.round((wins / games) * maxTicks)

  // rounding can hide a side that played, and one win or loss still matters at a glance
  const lowest = wins > 0 ? 1 : 0
  const highest = losses > 0 ? maxTicks - 1 : maxTicks
  const winTicks = Math.min(Math.max(scaledWins, lowest), highest)

  return { winTicks, lossTicks: maxTicks - winTicks }
}
