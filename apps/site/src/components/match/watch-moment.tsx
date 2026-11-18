import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

// a request to play the match from a moment; the count tells two requests for the same moment apart
export type WatchRequest = { timeMs: number; count: number }

type Watching = { request: WatchRequest | null; watch: (timeMs: number) => void }

const WatchContext = createContext<Watching | null>(null)

/** Lets any part of the page ask the replay to play the match from a moment. */
export function WatchProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<WatchRequest | null>(null)

  const watching = useMemo<Watching>(() => {
    const watch = (timeMs: number) => setRequest((previous) => ({ timeMs, count: (previous?.count ?? 0) + 1 }))

    return { request, watch }
  }, [request])

  return <WatchContext value={watching}>{children}</WatchContext>
}

/** The latest request to play from a moment, for the replay. */
export function useWatchRequest(): WatchRequest | null {
  return useContext(WatchContext)?.request ?? null
}

/** Asks the replay to play from a moment; null on a page without a replay. */
export function useWatch(): ((timeMs: number) => void) | null {
  return useContext(WatchContext)?.watch ?? null
}
