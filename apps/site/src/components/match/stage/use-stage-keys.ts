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
}

/** The replay's keys: space plays, the arrows step (further with shift), F fills the screen and Escape leaves it. */
export function useStageKeys({ frameRef, playback, fullscreen, onStep, onUsed }: StageKeys) {
  useReplayKeys(frameRef, (event) => {
    if (event.key === ' ') playback.toggle()
    else if (event.key === 'ArrowLeft') onStep(-1, event.shiftKey)
    else if (event.key === 'ArrowRight') onStep(1, event.shiftKey)
    else if (event.key === 'f' || event.key === 'F') fullscreen.toggle()
    // the browser leaves its own fullscreen on Escape; this covers the overlay, and a browser that hands the key on
    else if (event.key === 'Escape' && fullscreen.isOn) fullscreen.exit()
    else return false

    onUsed()

    return true
  })
}
