import type { RefObject } from 'react'
import type { Fullscreen } from './use-fullscreen'
import type { Playback } from './use-playback'
import { useReplayKeys } from './use-replay-keys'

type StageKeys = {
  frameRef: RefObject<HTMLElement | null>
  playback: Playback
  fullscreen: Fullscreen
  onStep: (direction: -1 | 1, isLong: boolean) => void
  // a key that moves the clock brings the controls on the stage back, as moving the pointer does
  onUsed: () => void
  // R in a review plays the stop again; Escape outside fullscreen leaves the review
  onReplayStop?: () => void
  onLeave?: () => void
}

/**
 * The replay's keys: space plays, the arrows step (further with shift), F fills the screen and Escape leaves it. In a
 * review R plays the stop again, and Escape leaves the review once the screen is back.
 */
export function useStageKeys({ frameRef, playback, fullscreen, onStep, onUsed, onReplayStop, onLeave }: StageKeys) {
  useReplayKeys(frameRef, (event) => {
    if (event.key === ' ') playback.toggle()
    else if (event.key === 'ArrowLeft') onStep(-1, event.shiftKey)
    else if (event.key === 'ArrowRight') onStep(1, event.shiftKey)
    else if (event.key === 'f' || event.key === 'F') fullscreen.toggle()
    // the browser leaves its own fullscreen on Escape; this covers the overlay, and a browser that hands the key on
    else if (event.key === 'Escape' && fullscreen.isOn) fullscreen.exit()
    else if ((event.key === 'r' || event.key === 'R') && onReplayStop) onReplayStop()
    else if (event.key === 'Escape' && onLeave) onLeave()
    else return false

    onUsed()

    return true
  })
}
