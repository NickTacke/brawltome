import type { RefreshPush } from './refresh-run'

export type RefreshEventSource = {
  readonly readyState: number
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export type CreateRefreshEventSource = (url: string) => RefreshEventSource

/** EventSource.CLOSED: the browser gave up (a non-200 answer, such as the API's 429 stream cap). */
const CLOSED = 2
/** Reconnect failures in a row, without the server confirming the subscription, before falling back to polling. */
const MAX_CONSECUTIVE_ERRORS = 5

export function playerRefreshEventsUrl(apiUrl: string, id: number): string {
  return `${apiUrl}/events/player/${encodeURIComponent(String(id))}/refresh`
}

function browserEventSource(): CreateRefreshEventSource | undefined {
  if (typeof EventSource !== 'function') return undefined
  return (url) => new EventSource(url) as unknown as RefreshEventSource
}

/**
 * Subscribes to the API's refresh completion stream. `ready` (sent on every connect and reconnect), `settled`, and
 * `resync` each trigger a refetch; the server ends the stream after a settlement or ~1 minute and the browser
 * reconnects by itself. Without EventSource, or once it fails for good, the run falls back to polling.
 */
export function createRefreshEventPush(
  url: string,
  createEventSource: CreateRefreshEventSource | undefined = browserEventSource(),
): RefreshPush {
  return ({ wake, connected, unavailable }) => {
    if (!createEventSource) {
      unavailable()
      return () => {}
    }
    let source: RefreshEventSource | undefined
    try {
      source = createEventSource(url)
    } catch {
      unavailable()
      return () => {}
    }
    let closed = false
    let consecutiveErrors = 0
    const close = () => {
      if (closed) return
      closed = true
      source?.close()
    }

    source.addEventListener('ready', () => {
      if (closed) return
      consecutiveErrors = 0
      connected()
      wake()
    })
    source.addEventListener('resync', () => {
      if (!closed) wake()
    })
    source.addEventListener('settled', (event) => {
      if (closed) return
      wake()
      let status: unknown
      try {
        status = (JSON.parse(event.data) as { status?: unknown }).status
      } catch {
        status = undefined
      }
      // A dead-lettered refresh will not settle again: stop listening and let polling run out the clock.
      if (status === 'dead_letter') {
        close()
        unavailable()
      }
    })
    source.addEventListener('error', () => {
      if (closed) return
      consecutiveErrors += 1
      if (source?.readyState === CLOSED || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        close()
        unavailable()
      }
    })
    return close
  }
}
