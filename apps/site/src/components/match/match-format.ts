/** A time of the match as the game's clock shows it: minutes and seconds. */
export function formatClock(timeMs: number): string {
  const totalSeconds = Math.round(timeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatDamage(damage: number): string {
  return String(Math.round(damage))
}
