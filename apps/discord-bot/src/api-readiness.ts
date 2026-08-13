type Schedule = (check: () => Promise<boolean>, intervalMs: number) => () => void

export function createApiReadinessMonitor(options: {
  verify: () => Promise<boolean>
  now?: () => number
  intervalMs?: number
  maxAgeMs?: number
  schedule?: Schedule
}) {
  const now = options.now ?? Date.now
  const intervalMs = options.intervalMs ?? 10_000
  const maxAgeMs = options.maxAgeMs ?? 30_000
  let lastSuccessAt: number | null = null
  let inFlight: Promise<boolean> | undefined
  let stopped = false

  const check = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false)
    if (inFlight) return inFlight
    const work = (async () => {
      try {
        const succeeded = await options.verify()
        lastSuccessAt = succeeded && !stopped ? now() : null
        return succeeded && !stopped
      } catch {
        lastSuccessAt = null
        return false
      }
    })()
    inFlight = work
    void work.finally(() => {
      if (inFlight === work) inFlight = undefined
    })
    return work
  }

  const defaultSchedule: Schedule = (scheduledCheck, delay) => {
    const timer = setInterval(() => void scheduledCheck(), delay)
    timer.unref()
    return () => clearInterval(timer)
  }
  const cancelSchedule = (options.schedule ?? defaultSchedule)(check, intervalMs)

  const clear = () => {
    lastSuccessAt = null
  }

  return {
    check,
    isReady: () => lastSuccessAt !== null && now() - lastSuccessAt <= maxAgeMs,
    clear,
    stop: () => {
      stopped = true
      cancelSchedule()
      clear()
    },
  }
}
