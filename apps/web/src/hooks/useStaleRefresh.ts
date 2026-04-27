import { useEffect, useRef, useState } from 'react'
import { isStale } from '../lib/staleness'

export interface RefreshStateInput {
  startedAt: number | null
  now: number
  maxRefreshMs: number
}

export interface RefreshState {
  isRefreshing: boolean
}

export function computeRefreshState(input: RefreshStateInput): RefreshState {
  if (input.startedAt === null) {
    return { isRefreshing: false }
  }
  const elapsed = input.now - input.startedAt
  if (elapsed > input.maxRefreshMs) {
    return { isRefreshing: false }
  }
  return { isRefreshing: true }
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
  shouldStart: (data: T) => boolean
  isDone: (prev: T, next: T) => boolean
  pollMs?: number
  maxRefreshMs?: number
}

interface UseStaleRefreshResult<T> {
  data: T
  isRefreshing: boolean
  error: Error | null
}

export function useStaleRefresh<T>(opts: UseStaleRefreshOptions<T>): UseStaleRefreshResult<T> {
  const [data, setData] = useState<T>(opts.initialData)
  const [error, setError] = useState<Error | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(0)

  const queryFnRef = useRef(opts.queryFn)
  const shouldStartRef = useRef(opts.shouldStart)
  const isDoneRef = useRef(opts.isDone)
  const prevDataRef = useRef<T>(opts.initialData)
  const initialDataRef = useRef<T>(opts.initialData)
  const pollMsRef = useRef<number>(opts.pollMs ?? 2_000)
  const maxRefreshMsRef = useRef<number>(opts.maxRefreshMs ?? 30_000)

  queryFnRef.current = opts.queryFn
  shouldStartRef.current = opts.shouldStart
  isDoneRef.current = opts.isDone

  useEffect(() => {
    if (!shouldStartRef.current(initialDataRef.current)) return
    const start = Date.now()
    setStartedAt(start)
    setNow(start)

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled) return
      const elapsed = Date.now() - start
      if (elapsed > maxRefreshMsRef.current) {
        setError(new RefreshTimeoutError())
        setNow(Date.now())
        return
      }
      try {
        const next = await queryFnRef.current()
        if (cancelled) return
        setData(next)
        setNow(Date.now())
        if (isDoneRef.current(prevDataRef.current, next)) {
          setStartedAt(null)
          return
        }
        prevDataRef.current = next
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setNow(Date.now())
        setStartedAt(null)
        return
      }
      timeoutId = setTimeout(tick, pollMsRef.current)
    }

    timeoutId = setTimeout(tick, pollMsRef.current)

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const { isRefreshing } = computeRefreshState({
    startedAt,
    now,
    maxRefreshMs: maxRefreshMsRef.current,
  })

  return {
    data,
    isRefreshing,
    error,
  }
}

export { isStale }
