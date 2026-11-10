type Read<T> = () => Promise<T>

/** Serves one answer for `lifetimeMs`, and shares one read between callers. A failed refresh keeps the last answer. */
export function createReadCache<T>(read: Read<T>, lifetimeMs: number, nowMs: () => number = Date.now): Read<T> {
  let cached: { value: T; readAtMs: number } | null = null
  let refreshing: Promise<T> | null = null

  async function refresh(): Promise<T> {
    try {
      cached = { value: await read(), readAtMs: nowMs() }

      return cached.value
    } catch (error) {
      if (cached) return cached.value

      throw error
    } finally {
      refreshing = null
    }
  }

  return () => {
    if (cached && nowMs() - cached.readAtMs < lifetimeMs) return Promise.resolve(cached.value)

    // the reads behind this are whole-table scans, so callers arriving together must not each start one
    refreshing ??= refresh()

    return refreshing
  }
}
