export function formatDate(date: Date | string | null, locale = 'en-US'): string {
  if (date === null) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(locale, { timeZone: 'UTC' })
}

export function formatPlaytime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'
  const hours = seconds / 3600
  return `${hours.toFixed(1)}h`
}

export function formatWinrate(wins: number, games: number): string {
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games <= 0) return '-'
  const pct = (wins / games) * 100
  return `${pct.toFixed(1)}%`
}
