export function fixEncoding(str: string | null | undefined): string {
  if (!str) return ''
  try {
    return decodeURIComponent(escape(str))
  } catch {
    return str
  }
}

export function timeAgo(date: string | Date | number): string {
  const d = new Date(date)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

export function formatNum(n: number | string | bigint | undefined | null): string {
  if (n === null || n === undefined) return '0'
  if (typeof n === 'bigint') return n.toLocaleString()
  if (typeof n === 'string' && /^(0|[1-9]\d*)$/.test(n)) return BigInt(n).toLocaleString()
  if (typeof n !== 'number' || Number.isNaN(n)) return '0'
  return n.toLocaleString()
}
