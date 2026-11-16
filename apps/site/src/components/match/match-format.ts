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

/** A share as a whole percent; a dash where there was nothing to share. */
export function formatShare(share: number | null): string {
  return share === null ? '–' : `${Math.round(share * 100)}%`
}

/** A figure to one decimal; a dash where there is none. */
export function formatDecimal(value: number | null): string {
  return value === null ? '–' : value.toFixed(1)
}
