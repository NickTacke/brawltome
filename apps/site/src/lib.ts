// some names come back from the game api as utf-8 bytes read as latin-1
export function fixEncoding(value: string | null | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

const missingNumber = '—'
const unknownDate = 'Unknown'

export function formatWhole(value: string | bigint | number): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)).toLocaleString('en-GB') : missingNumber
  }

  if (typeof value === 'string' && !/^-?\d+$/.test(value)) return missingNumber

  return BigInt(value).toLocaleString('en-GB')
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDay(value: string | null): string {
  if (!value) return unknownDate

  const date = new Date(value)

  return isValidDate(date) ? dayFormatter.format(date) : unknownDate
}

export function timeAgo(value: string, now = new Date()): string {
  const date = new Date(value)

  if (!isValidDate(date)) return unknownDate

  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${hours} h ago`

  return `${Math.floor(hours / 24)} d ago`
}
