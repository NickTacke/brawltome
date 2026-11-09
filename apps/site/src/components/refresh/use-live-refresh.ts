import { type RefObject, useEffect, useRef, useState } from 'react'
import type { RefreshAnswer } from './refresh-answer'
import { type RefreshRun, type RefreshStatus, runRefresh } from './refresh-run'

/** A challenge the page shows; settle gets the answer, or null when the visitor could not be verified. */
export type Challenge = { siteKey: string; settle: (turnstileToken: string | null) => void }

type LiveRefreshOptions<T> = {
  initial: T
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

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// the invisible challenge answers in seconds, a script that never loads must not leave the page on "updating"
const challengeTimeoutMs = 30_000

export function askForChallenge(
  siteKey: string | null,
  setChallenge: RunSetup<unknown>['setChallenge'],
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

  useEffect(() => {
    // a retry always asks, the api knows best whether the data is still stale
    if (attempt === 0 && !optionsRef.current.isStale(dataRef.current)) return

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
  }, [attempt])

  return { data, status, challenge, retry: () => setAttempt((count) => count + 1) }
}
