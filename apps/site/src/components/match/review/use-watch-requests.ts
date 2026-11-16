import { type RefObject, useEffect } from 'react'
import type { Playback } from '../stage/use-playback'
import { useWatchRequest } from '../watch-moment'
import { leadInMs } from './use-review'

/**
 * Plays the replay from a moment another part of the page asked for, from a little before it so what led up to it is
 * seen, and brings the stage into view. A running review carries on from there.
 */
export function useWatchRequests(
  frameRef: RefObject<HTMLDivElement | null>,
  playback: Playback,
  seekByHand: (timeMs: number) => void,
) {
  const request = useWatchRequest()

  // only when a new request arrives; seeking and playing don't change what was asked for
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!request) return

    seekByHand(Math.max(request.timeMs - leadInMs, 0))
    playback.play()
    frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [request])
}
