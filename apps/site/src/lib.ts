// some names come back from the game api as utf-8 bytes read as latin-1
export function fixEncoding(value: string | null | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

export function formatWhole(value: string | bigint | number): string {
  return BigInt(value).toLocaleString('en-GB')
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDay(value: string | null): string {
  return value ? dayFormatter.format(new Date(value)) : 'Unknown'
}

export function timeAgo(value: string, now = new Date()): string {
  const seconds = Math.floor((now.getTime() - new Date(value).getTime()) / 1000)

  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) return `${hours} h ago`

  return `${Math.floor(hours / 24)} d ago`
}
