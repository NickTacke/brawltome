export type PollDelay = number | ((elapsedMs: number) => number)

export function resolvePollDelay(pollMs: PollDelay, elapsedMs: number): number {
  return typeof pollMs === 'function' ? pollMs(elapsedMs) : pollMs
}

export class RefreshTimeoutError extends Error {
  constructor() {
    super('Refresh timed out')
    this.name = 'RefreshTimeoutError'
  }
}

export type StaleRefreshSettlement = 'done' | 'timeout' | 'error'

/** Signals from a push channel (server-sent events) while a refresh run is active. */
export type RefreshPushHandlers = {
  /** Refetch now: the refresh settled, or the channel (re)connected and may have missed a settlement. */
  wake: () => void
  /** The channel is live, so polling can slow to a safety net. */
  connected: () => void
  /** The channel failed for good; poll at the fallback interval. */
  unavailable: () => void
}

/** Opens a push channel for one run and returns the function that closes it. */
export type RefreshPush = (handlers: RefreshPushHandlers) => () => void

export type RefreshRunClock = {
  now: () => number
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const systemClock: RefreshRunClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type RefreshRunOptions<T> = {
  initial: T
  queryFn: () => Promise<T>
  isDone: (previous: T, next: T) => boolean
  /** Polling schedule without a live push channel. */
  pollMs: PollDelay
  /** Polling schedule while the push channel is live; defaults to `pollMs`. */
  pushedPollMs?: PollDelay
  maxRefreshMs: number
  push?: RefreshPush
  onData: (next: T) => void
  onSettled: (settlement: StaleRefreshSettlement, error?: Error) => void
  clock?: RefreshRunClock
}

/**
 * Polls `queryFn` until `isDone`, the deadline, or an error. A push channel can wake the run for an immediate refetch
 * and, while it is live, stretch polling to a safety net. Returns a function that stops the run and closes the channel.
 */
export function startRefreshRun<T>(options: RefreshRunOptions<T>): () => void {
  const clock = options.clock ?? systemClock
  const start = clock.now()
  let previous = options.initial
  let stopped = false
  let timer: unknown = null
  let inFlight = false
  let wakeQueued = false
  let pushed = false
  let closePush: (() => void) | undefined

  const clearTimer = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimer()
    const close = closePush
    closePush = undefined
    close?.()
  }

  const settle = (settlement: StaleRefreshSettlement, error?: Error) => {
    stop()
    options.onSettled(settlement, error)
  }

  const schedule = () => {
    clearTimer()
    const schedulePollMs = pushed && options.pushedPollMs !== undefined ? options.pushedPollMs : options.pollMs
    timer = clock.setTimeout(() => void tick(), resolvePollDelay(schedulePollMs, clock.now() - start))
  }

  const tick = async () => {
    if (stopped) return
    timer = null
    if (clock.now() - start > options.maxRefreshMs) {
      settle('timeout', new RefreshTimeoutError())
      return
    }
    inFlight = true
    let next: T
    try {
      next = await options.queryFn()
    } catch (error) {
      inFlight = false
      if (!stopped) settle('error', error instanceof Error ? error : new Error(String(error)))
      return
    }
    inFlight = false
    if (stopped) return
    options.onData(next)
    if (options.isDone(previous, next)) {
      settle('done')
      return
    }
    previous = next
    if (wakeQueued) {
      wakeQueued = false
      void tick()
      return
    }
    schedule()
  }

  const handlers: RefreshPushHandlers = {
    wake: () => {
      if (stopped) return
      if (inFlight) {
        wakeQueued = true
        return
      }
      clearTimer()
      void tick()
    },
    connected: () => {
      if (stopped || pushed) return
      pushed = true
      if (!inFlight && timer !== null) schedule()
    },
    unavailable: () => {
      if (stopped) return
      const close = closePush
      closePush = undefined
      close?.()
      if (!pushed) return
      pushed = false
      if (!inFlight) schedule()
    },
  }

  schedule()
  if (options.push) {
    const close = options.push(handlers)
    if (stopped) close()
    else closePush = close
  }
  return stop
}
