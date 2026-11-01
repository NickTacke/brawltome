import { useEffect, useRef, useState } from 'react'
import {
  type PollDelay,
  type RefreshPush,
  type StaleRefreshSettlement,
  resolvePollDelay,
  startRefreshRun,
} from '../lib/refresh-run'
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

export {
  type PollDelay,
  type RefreshPush,
  RefreshTimeoutError,
  type StaleRefreshSettlement,
  resolvePollDelay,
} from '../lib/refresh-run'

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
  /** Push channel opened for each run: it wakes the run for an immediate refetch. */
  push?: RefreshPush
  /** Polling schedule while the push channel is live; defaults to `pollMs`. */
  pushedPollMs?: PollDelay
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
  const pushRef = useRef(opts.push)
  const dataRef = useRef<T>(opts.initialData)
  const pollMsRef = useRef<PollDelay>(opts.pollMs ?? 2_000)
  const pushedPollMsRef = useRef<PollDelay | undefined>(opts.pushedPollMs)
  const maxRefreshMsRef = useRef<number>(opts.maxRefreshMs ?? 30_000)

  queryFnRef.current = opts.queryFn
  shouldStartRef.current = opts.shouldStart
  isDoneRef.current = opts.isDone
  onSettledRef.current = opts.onSettled
  pushRef.current = opts.push
  pollMsRef.current = opts.pollMs ?? 2_000
  pushedPollMsRef.current = opts.pushedPollMs
  maxRefreshMsRef.current = opts.maxRefreshMs ?? 30_000

  // biome-ignore lint/correctness/useExhaustiveDependencies: runKey intentionally restarts polling.
  useEffect(() => {
    if (opts.startSignal === false || !shouldStartRef.current(dataRef.current)) return
    const start = Date.now()
    setError(null)
    setStartedAt(start)
    setNow(start)

    return startRefreshRun<T>({
      initial: dataRef.current,
      queryFn: () => queryFnRef.current(),
      isDone: (previous, next) => isDoneRef.current(previous, next),
      pollMs: (elapsedMs) => resolvePollDelay(pollMsRef.current, elapsedMs),
      pushedPollMs:
        pushedPollMsRef.current === undefined
          ? undefined
          : (elapsedMs) => resolvePollDelay(pushedPollMsRef.current ?? pollMsRef.current, elapsedMs),
      maxRefreshMs: maxRefreshMsRef.current,
      push: pushRef.current,
      onData: (next) => {
        dataRef.current = next
        setData(next)
        setNow(Date.now())
      },
      onSettled: (settlement: StaleRefreshSettlement, settledError?: Error) => {
        if (settledError) setError(settledError)
        setNow(Date.now())
        if (settlement !== 'timeout') setStartedAt(null)
        onSettledRef.current?.(settlement)
      },
    })
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
