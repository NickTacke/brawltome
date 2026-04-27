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
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

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
    const maxRefreshMs = maxRefreshMsRef.current
    const pollMs = pollMsRef.current
    setIsRefreshing(true)

    const interval = setInterval(async () => {
      const elapsed = Date.now() - start
      if (elapsed > maxRefreshMs) {
        setError(new RefreshTimeoutError())
        setIsRefreshing(false)
        clearInterval(interval)
        return
      }
      try {
        const next = await queryFnRef.current()
        setData(next)
        if (isDoneRef.current(prevDataRef.current, next)) {
          setIsRefreshing(false)
          clearInterval(interval)
        } else {
          prevDataRef.current = next
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsRefreshing(false)
        clearInterval(interval)
      }
    }, pollMs)

    return () => clearInterval(interval)
  }, [])

  return {
    data,
    isRefreshing,
    error,
  }
}

export { isStale }
