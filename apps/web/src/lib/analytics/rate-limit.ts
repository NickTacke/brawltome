// Keyed by tab id or client address; the key lives only in this process's memory and is never logged.
export function createTabRateLimiter(limitPerMinute: number, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    allow(key: string): boolean {
      const time = now()
      if (windows.size > 50_000) windows.clear()
      const window = windows.get(key)
      if (!window || time - window.start >= 60_000) {
        windows.set(key, { start: time, count: 1 })
        return true
      }
      window.count += 1
      return window.count <= limitPerMinute
    },
  }
}
