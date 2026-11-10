export function formatChange(change: number): string {
  return change > 0 ? `+${change}` : String(change)
}

// the same green and red the player page uses for rating changes
export function changeColour(change: number): string {
  if (change > 0) return 'text-emerald-400'

  return change < 0 ? 'text-red-400' : 'text-soft'
}

/** Whose row this is: a fixed 2v2 entry is a team, every other bracket lists players. */
export function rowNoun(mode: string): string {
  return mode === '2v2' ? 'teams' : 'players'
}

type PageSpan = { page: number; totalRows: number; pageSize: number }

/** A page past the end keeps the pager too, so the reader can get back. */
export function hasPager({ page, totalRows, pageSize }: PageSpan): boolean {
  return totalRows > pageSize || page > 1
}

const roundingMinutes = 5

type ScanSpan = { previousObservedAt: string; currentObservedAt: string }

/** The time between the two compared scans, such as "Last 1 h 15 min". Scans land about hourly, not on the hour. */
export function spanLabel({ previousObservedAt, currentObservedAt }: ScanSpan): string {
  const spanMinutes = (Date.parse(currentObservedAt) - Date.parse(previousObservedAt)) / 60_000
  const minutes = Math.round(spanMinutes / roundingMinutes) * roundingMinutes
  const hours = Math.floor(minutes / 60)
  const minutesPastHour = minutes % 60

  if (hours === 0) return `Last ${minutes} min`

  if (minutesPastHour > 0) return `Last ${hours} h ${minutesPastHour} min`

  return hours === 1 ? 'Last hour' : `Last ${hours} hours`
}
