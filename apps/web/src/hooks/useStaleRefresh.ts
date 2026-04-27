import { useEffect, useRef, useState } from 'react'
import { isStale } from '../lib/staleness'

export interface RefreshStateInput {
  startedAt: number | null
  now: number
  maxRefreshMs: number
}

export interface RefreshState {
  isRefreshing: boolean
  isTimedOut: boolean
}

export function computeRefreshState(input: RefreshStateInput): RefreshState {
  if (input.startedAt === null) {
    return { isRefreshing: false, isTimedOut: false }
  }
  const elapsed = input.now - input.startedAt
  if (elapsed > input.maxRefreshMs) {
    return { isRefreshing: false, isTimedOut: true }
  }
  return { isRefreshing: true, isTimedOut: false }
}

export class RefreshTimeoutError extends Error {
  constructor() {
    super('Refresh timed out')
    this.name = 'RefreshTimeoutError'
  }
}

interface UseStaleRefreshOptions<T> {
  initialData: T
  queryFn: () => Promise<T>
  isStaleFn: (data: T) => boolean
  pollMs?: number
  maxRefreshMs?: number
}

interface UseStaleRefreshResult<T> {
  data: T
  isRefreshing: boolean
  error: Error | null
}

export function useStaleRefresh<T>(opts: UseStaleRefreshOptions<T>): UseStaleRefreshResult<T> {
  const pollMs = opts.pollMs ?? 2_000
  const maxRefreshMs = opts.maxRefreshMs ?? 30_000

  const [data, setData] = useState<T>(opts.initialData)
  const [error, setError] = useState<Error | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(0)
  const startedAtRef = useRef<number | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally runs once on mount; opts.queryFn/isStaleFn are treated as stable, and pollMs/maxRefreshMs are captured at start.
  useEffect(() => {
    if (!opts.isStaleFn(opts.initialData)) return
    const start = Date.now()
    startedAtRef.current = start
    setStartedAt(start)
    setNow(start)

    const interval = setInterval(async () => {
      const elapsed = Date.now() - (startedAtRef.current ?? Date.now())
      if (elapsed > maxRefreshMs) {
        setError(new RefreshTimeoutError())
        setNow(Date.now())
        clearInterval(interval)
        return
      }
      try {
        const next = await opts.queryFn()
        setData(next)
        setNow(Date.now())
        if (!opts.isStaleFn(next)) {
          startedAtRef.current = null
          setStartedAt(null)
          clearInterval(interval)
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setNow(Date.now())
        clearInterval(interval)
      }
    }, pollMs)

    return () => clearInterval(interval)
  }, [])

  const state = computeRefreshState({ startedAt, now, maxRefreshMs })

  return {
    data,
    isRefreshing: state.isRefreshing,
    error,
  }
}

export { isStale }
