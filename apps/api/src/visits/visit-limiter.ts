const windowMs = 60_000
// past this many visitors in one minute the map starts over, so a flood can't grow it without end
const maxTrackedVisitors = 50_000

/** Counts page views per visitor key in one minute windows, in memory only. */
export function createVisitLimiter(visitsPerMinute: number, now: () => number) {
  const windows = new Map<string, { startMs: number; count: number }>()

  function allow(visitorKey: string): boolean {
    const timeMs = now()
    const window = windows.get(visitorKey)

    if (window && timeMs - window.startMs < windowMs) {
      window.count += 1

      return window.count <= visitsPerMinute
    }

    if (windows.size >= maxTrackedVisitors) windows.clear()

    windows.set(visitorKey, { startMs: timeMs, count: 1 })

    return true
  }

  return { allow }
}

export type VisitLimiter = ReturnType<typeof createVisitLimiter>
