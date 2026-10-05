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

interface UseStaleRefreshOptions<T> {
  initialData: T
  queryFn: () => Promise<T>
  shouldStart: (data: T) => boolean
  isDone: (prev: T, next: T) => boolean
  startSignal?: boolean
  /** Changing this while `startSignal` is true starts a fresh polling run from the current data. */
  runKey?: number
  /** Fixed delay, or a schedule computed from the elapsed time of the current run. */
  pollMs?: PollDelay
  maxRefreshMs?: number
  onSettled?: (settlement: StaleRefreshSettlement) => void
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
  const onSettledRef = useRef(opts.onSettled)
  const dataRef = useRef<T>(opts.initialData)
  const prevDataRef = useRef<T>(opts.initialData)
  const pollMsRef = useRef<PollDelay>(opts.pollMs ?? 2_000)
  const maxRefreshMsRef = useRef<number>(opts.maxRefreshMs ?? 30_000)

  queryFnRef.current = opts.queryFn
  shouldStartRef.current = opts.shouldStart
  isDoneRef.current = opts.isDone
  onSettledRef.current = opts.onSettled
  pollMsRef.current = opts.pollMs ?? 2_000
  maxRefreshMsRef.current = opts.maxRefreshMs ?? 30_000

  // biome-ignore lint/correctness/useExhaustiveDependencies: runKey intentionally restarts polling.
  useEffect(() => {
    if (opts.startSignal === false || !shouldStartRef.current(dataRef.current)) return
    const start = Date.now()
    prevDataRef.current = dataRef.current
    setError(null)
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
        onSettledRef.current?.('timeout')
        return
      }
      try {
        const next = await queryFnRef.current()
        if (cancelled) return
        dataRef.current = next
        setData(next)
        setNow(Date.now())
        if (isDoneRef.current(prevDataRef.current, next)) {
          setStartedAt(null)
          onSettledRef.current?.('done')
          return
        }
        prevDataRef.current = next
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setNow(Date.now())
        setStartedAt(null)
        onSettledRef.current?.('error')
        return
      }
      schedule()
    }

    const schedule = () => {
      timeoutId = setTimeout(tick, resolvePollDelay(pollMsRef.current, Date.now() - start))
    }

    schedule()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [opts.startSignal, opts.runKey])

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
