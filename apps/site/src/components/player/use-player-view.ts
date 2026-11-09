import { useEffect, useRef } from 'react'

/**
 * Counts one view when a player page is on screen. An effect never runs for a prefetch or in the server render, and
 * crawlers that don't run scripts never reach it; the api leaves out the ones that do.
 */
export function usePlayerView(playerId: number, recordPlayerView: (playerId: number) => Promise<unknown>) {
  const hasRecordedRef = useRef(false)

  useEffect(() => {
    // strict mode runs effects twice in development, the ref survives that
    if (hasRecordedRef.current) return

    hasRecordedRef.current = true

    recordPlayerView(playerId).catch(() => undefined)
  }, [playerId, recordPlayerView])
}
