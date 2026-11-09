import { failureText } from './optional-read'

type CacheTimes = {
  // how long a good copy is served before the source is asked again
  freshMs: number
  // how long to leave a failing source alone, so every page view doesn't wait on it
  retryMs: number
}

type CachedCopy<T> = { value: T | null; nextReadAtMs: number }

/**
 * Wraps a read so callers share one copy for a while. When the source fails, the last good copy is kept, or null
 * when there never was one.
 */
export function cachedRead<T>(read: () => Promise<T>, { freshMs, retryMs }: CacheTimes) {
  let copy: CachedCopy<T> = { value: null, nextReadAtMs: 0 }
  let pendingRead: Promise<T | null> | null = null

  async function refresh(nowMs: number): Promise<T | null> {
    try {
      copy = { value: await read(), nextReadAtMs: nowMs + freshMs }
    } catch (error) {
      console.error(failureText(error))

      copy = { value: copy.value, nextReadAtMs: nowMs + retryMs }
    }

    return copy.value
  }

  return function load(nowMs = Date.now()): Promise<T | null> {
    if (nowMs < copy.nextReadAtMs) return Promise.resolve(copy.value)

    if (pendingRead) return pendingRead

    pendingRead = refresh(nowMs).finally(() => {
      pendingRead = null
    })

    return pendingRead
  }
}
