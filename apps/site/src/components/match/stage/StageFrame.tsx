import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { frameAspect } from './play-camera'
import type { Fullscreen } from './use-fullscreen'
import type { StageControlsState } from './use-stage-controls'

// the stage alone on the screen, in the middle of it; laid over the page where the browser can't fill the screen
const fullscreenFrame = '@container flex items-center justify-center bg-black'
const overlaidFrame = 'fixed inset-0 z-[100]'
// on a phone's page the stage runs to the screen's edges, past the page's px-6 gutter
const phoneBleed = 'phone:-mx-6'
// hidden with the controls, but back with them when the keyboard or an open menu brings them back, see shownOnStage
const pointerHidden = '[&:not(:has(:focus-visible,[aria-expanded=true]))]:cursor-none'

type StageFrameProps = {
  frameRef: RefObject<HTMLDivElement | null>
  fullscreen: Fullscreen
  controls: StageControlsState
  children: ReactNode
}

/** What fills the screen in fullscreen, around the stage, which takes the pointer like a video does. */
export function StageFrame({ frameRef, fullscreen, controls, children }: StageFrameProps) {
  const frameLook = fullscreen.isOn ? `${fullscreenFrame} ${fullscreen.isOverlay ? overlaidFrame : ''}` : ''
  // letterboxed: as wide as the screen, or as wide as its height allows at the frame's shape, the game's screen's
  const stageSize = fullscreen.isOn ? { width: `min(100%, calc(100dvh * ${frameAspect}))` } : undefined
  // the pointer goes with the controls over a stage that fills the screen, as over a video
  const isPointerHidden = fullscreen.isOn && !controls.isShown
  const stageLook = fullscreen.isOn ? '' : phoneBleed

  const frame = (
    <div ref={frameRef} className={`min-w-0 ${frameLook}`}>
      {/* moving over the stage shows the controls, a press on it plays or pauses */}
      <div {...controls.stage} style={stageSize} className={`${stageLook} ${isPointerHidden ? pointerHidden : ''}`}>
        {children}
      </div>
    </div>
  )

  // a transformed ancestor, like the wide page's centring, would hold a fixed frame inside itself instead of the
  // screen, so the overlay hangs from the body
  return fullscreen.isOverlay ? createPortal(frame, document.body) : frame
}
