export function formatDate(date: Date | string | null, locale = 'en-US'): string {
  if (date === null) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(locale, { timeZone: 'UTC' })
}
