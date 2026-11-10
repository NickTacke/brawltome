import { type RefObject, useEffect, useRef, useState } from 'react'
import type { RefreshAnswer } from './refresh-answer'
import { type RefreshRun, type RefreshStatus, runRefresh } from './refresh-run'

/** A challenge the page shows; settle gets the answer, or null when the visitor could not be verified. */
export type Challenge = { siteKey: string; settle: (turnstileToken: string | null) => void }

type LiveRefreshOptions<T> = {
  initial: T
  // changes only when the page is loaded again; the data object itself can be rebuilt on every render
  loadKey: string
  isStale: (data: T) => boolean
  isRefreshed: (baseline: T, current: T) => boolean
  // null when the page is gone, which keeps the data on screen
  load: () => Promise<T | null>
  refresh: (turnstileToken?: string) => Promise<RefreshAnswer>
}

type RunSetup<T> = {
  options: RefObject<LiveRefreshOptions<T>>
  data: RefObject<T>
  setData: (data: T) => void
  setStatus: (status: RefreshStatus) => void
  setChallenge: (challenge: Challenge | null) => void
  isCancelled: () => boolean
}

export function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// the invisible challenge answers in seconds, a script that never loads must not leave the page on "updating"
const challengeTimeoutMs = 30_000

/** Shows the challenge until the visitor settles it or it times out; without a site key there is nothing to show. */
export function askForChallenge(
  siteKey: string | null,
  setChallenge: (challenge: Challenge | null) => void,
  timeoutMs = challengeTimeoutMs,
): Promise<string | null> {
  if (!siteKey) return Promise.resolve(null)

  return new Promise<string | null>((resolve) => {
    let isSettled = false

    const settle = (turnstileToken: string | null) => {
      if (isSettled) return

      isSettled = true
      clearTimeout(timer)
      setChallenge(null)
      resolve(turnstileToken)
    }

    const timer = setTimeout(() => settle(null), timeoutMs)

    setChallenge({ siteKey, settle })
  })
}

function createRun<T>(setup: RunSetup<T>): RefreshRun {
  const baseline = setup.data.current

  const reload = async () => {
    const next = await setup.options.current.load()

    if (!next || setup.isCancelled()) return

    setup.data.current = next
    setup.setData(next)
  }

  const setStatus = (status: RefreshStatus) => {
    if (!setup.isCancelled()) setup.setStatus(status)
  }

  return {
    request: (turnstileToken) => setup.options.current.refresh(turnstileToken),
    solveChallenge: (siteKey) => askForChallenge(siteKey, setup.setChallenge),
    reload,
    isRefreshed: () => setup.options.current.isRefreshed(baseline, setup.data.current),
    wait: waitFor,
    isCancelled: setup.isCancelled,
    setStatus,
  }
}

/**
 * Keeps a page's data live: a stale page asks for a refresh once it is on screen, then reloads its data until the
 * fresh data lands. The first html never asks, so prefetches and crawlers that don't run scripts cost nothing.
 */
export function useLiveRefresh<T>(options: LiveRefreshOptions<T>) {
  const [data, setData] = useState(options.initial)
  const [status, setStatus] = useState<RefreshStatus>('idle')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [attempt, setAttempt] = useState(0)
  const optionsRef = useRef(options)
  const dataRef = useRef(data)

  optionsRef.current = options

  const { loadKey } = options

  // a new load of the page, such as navigating to it again, replaces what a run loaded before and starts over
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey marks a new load, the data is read from the ref
  useEffect(() => {
    const { initial } = optionsRef.current

    dataRef.current = initial
    setData(initial)
    setStatus('idle')
    setChallenge(null)
  }, [loadKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadKey marks a new load, the data is read from the ref
  useEffect(() => {
    // a retry always asks, the api knows best whether the data is still stale
    if (attempt === 0 && !optionsRef.current.isStale(optionsRef.current.initial)) return

    let isCancelled = false

    const setup = {
      options: optionsRef,
      data: dataRef,
      setData,
      setStatus,
      setChallenge,
      isCancelled: () => isCancelled,
    }

    void runRefresh(createRun(setup))

    return () => {
      isCancelled = true
    }
  }, [attempt, loadKey])

  return { data, status, challenge, retry: () => setAttempt((count) => count + 1) }
}
