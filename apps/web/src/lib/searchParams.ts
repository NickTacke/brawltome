export function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  if (raw === null) return fallback
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export function parseInteger(raw: string | null, opts: { min?: number; max?: number; default: number }): number {
  let value: number
  if (raw === null) {
    value = opts.default
  } else {
    const parsed = Number.parseInt(raw, 10)
    value = Number.isNaN(parsed) ? opts.default : parsed
  }
  if (opts.min !== undefined && value < opts.min) value = opts.min
  if (opts.max !== undefined && value > opts.max) value = opts.max
  return value
}

export function buildQueryString(obj: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  return params.toString()
}
