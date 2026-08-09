export type RuntimeState = 'starting' | 'ready' | 'draining' | 'stopped'

export type ReadinessProbe = {
  name: string
  check: () => Promise<void>
}

export type RuntimeCloser = {
  name: string
  close: () => Promise<void>
}

export type RuntimeLifecycleOptions = {
  shutdownDeadlineMs: number
  cleanupReserveMs?: number
  readinessProbes?: readonly ReadinessProbe[]
  closers?: readonly RuntimeCloser[]
  stopAdmission?: () => void
  now?: () => number
}

export type ReadinessResult =
  | { ready: true }
  | { ready: false; reason: 'starting' | 'draining' | 'stopped' | 'dependency'; dependency?: string }

export type ShutdownResult = {
  drained: boolean
  cleanupCompleted: boolean
  errors: readonly { resource: string; error: unknown }[]
}

export function createRuntimeLifecycle(options: RuntimeLifecycleOptions) {
  const now = options.now ?? Date.now
  const cleanupReserveMs = options.cleanupReserveMs ?? Math.min(5_000, Math.floor(options.shutdownDeadlineMs / 4))
  if (!Number.isInteger(options.shutdownDeadlineMs) || options.shutdownDeadlineMs <= 0) {
    throw new Error('shutdownDeadlineMs must be a positive integer')
  }
  if (!Number.isInteger(cleanupReserveMs) || cleanupReserveMs < 0 || cleanupReserveMs >= options.shutdownDeadlineMs) {
    throw new Error('cleanupReserveMs must be a non-negative integer smaller than shutdownDeadlineMs')
  }

  let state: RuntimeState = 'starting'
  let activeWork = 0
  let shutdownPromise: Promise<ShutdownResult> | undefined
  const drainWaiters = new Set<() => void>()
  const shutdownController = new AbortController()

  function markReady(): void {
    if (state === 'starting') state = 'ready'
  }

  function startWork(): (() => void) | null {
    if (state !== 'ready') return null
    activeWork++
    let finished = false
    return () => {
      if (finished) return
      finished = true
      activeWork--
      if (activeWork === 0) {
        for (const resolve of drainWaiters) resolve()
        drainWaiters.clear()
      }
    }
  }

  function beginShutdown(): void {
    if (state === 'draining' || state === 'stopped') return
    state = 'draining'
    shutdownController.abort()
    options.stopAdmission?.()
  }

  async function readiness(): Promise<ReadinessResult> {
    if (state !== 'ready') return { ready: false, reason: state }
    for (const probe of options.readinessProbes ?? []) {
      try {
        await probe.check()
      } catch {
        return { ready: false, reason: 'dependency', dependency: probe.name }
      }
      if (state !== 'ready') return { ready: false, reason: state }
    }
    return { ready: true }
  }

  function waitUntilIdle(timeoutMs: number): Promise<boolean> {
    if (activeWork === 0) return Promise.resolve(true)
    if (timeoutMs <= 0) return Promise.resolve(false)
    return new Promise((resolve) => {
      let settled = false
      const finish = (drained: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        drainWaiters.delete(onDrained)
        resolve(drained)
      }
      const onDrained = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      drainWaiters.add(onDrained)
    })
  }

  function waitForSettled<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
    if (timeoutMs <= 0) {
      void promise.catch(() => undefined)
      return Promise.resolve(undefined)
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: T | undefined) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => finish(undefined), timeoutMs)
      promise.then(finish, () => finish(undefined))
    })
  }

  function shutdown(): Promise<ShutdownResult> {
    if (shutdownPromise) return shutdownPromise
    beginShutdown()
    const deadlineAt = now() + options.shutdownDeadlineMs
    const drainDeadlineAt = deadlineAt - cleanupReserveMs

    shutdownPromise = (async () => {
      const drained = await waitUntilIdle(Math.max(0, drainDeadlineAt - now()))
      const cleanup = (async () => {
        const results: ({ resource: string; error: unknown } | null)[] = []
        for (const { name, close } of options.closers ?? []) {
          try {
            await close()
            results.push(null)
          } catch (error) {
            results.push({ resource: name, error })
          }
        }
        return results
      })()
      const cleanupResults = await waitForSettled(cleanup, Math.max(0, deadlineAt - now()))
      state = 'stopped'
      return {
        drained,
        cleanupCompleted: cleanupResults !== undefined,
        errors:
          cleanupResults?.filter((result): result is { resource: string; error: unknown } => result !== null) ?? [],
      }
    })()
    return shutdownPromise
  }

  return {
    markReady,
    startWork,
    beginShutdown,
    readiness,
    shutdown,
    get state(): RuntimeState {
      return state
    },
    get activeWork(): number {
      return activeWork
    },
    get signal(): AbortSignal {
      return shutdownController.signal
    },
  }
}

export type RuntimeLifecycle = ReturnType<typeof createRuntimeLifecycle>
