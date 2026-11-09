import { useEffect, useRef, useState } from 'react'
import type { RefreshAnswer } from '../refresh/refresh-answer'
import { askForChallenge, type Challenge, waitFor } from '../refresh/use-live-refresh'
import { type LookupRun, type LookupStatus, runLookup } from './lookup-run'

type PlayerLookupOptions = {
  // null while the player isn't stored yet
  load: () => Promise<unknown | null>
  lookUp: (turnstileToken?: string) => Promise<RefreshAnswer>
  onFound: () => void
}

/**
 * Looks up a player the site has never stored, once the page is on screen. The first html never asks, so crawlers
 * reading random ids cost no lookups, and every lookup goes through the api's refresh admission.
 */
export function usePlayerLookup(options: PlayerLookupOptions) {
  const [status, setStatus] = useState<LookupStatus>('looking')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [attempt, setAttempt] = useState(0)
  const optionsRef = useRef(options)

  optionsRef.current = options

  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry bumps the attempt to start a new lookup
  useEffect(() => {
    let isCancelled = false
    let isFound = false

    const run: LookupRun = {
      request: (turnstileToken) => optionsRef.current.lookUp(turnstileToken),
      solveChallenge: (siteKey) => askForChallenge(siteKey, setChallenge),
      reload: async () => {
        isFound = (await optionsRef.current.load()) !== null
      },
      isRefreshed: () => isFound,
      wait: waitFor,
      isCancelled: () => isCancelled,
      setStatus: (next) => {
        if (!isCancelled) setStatus(next)
      },
    }

    void runLookup(run)

    return () => {
      isCancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (status === 'found') optionsRef.current.onFound()
  }, [status])

  return { status, challenge, retry: () => setAttempt((count) => count + 1) }
}
