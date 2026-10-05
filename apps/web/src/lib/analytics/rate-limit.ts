export function createTabRateLimiter(limitPerMinute: number, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    allow(tabId: string): boolean {
      const time = now()
      if (windows.size > 50_000) windows.clear()
      const window = windows.get(tabId)
      if (!window || time - window.start >= 60_000) {
        windows.set(tabId, { start: time, count: 1 })
        return true
      }
      window.count += 1
      return window.count <= limitPerMinute
    },
  }
}
