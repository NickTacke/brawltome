import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Fullscreen } from './use-fullscreen'
import type { StageControlsState } from './use-stage-controls'

// the stage alone on the screen, in the middle of it; laid over the page where the browser can't fill the screen
const fullscreenFrame = '@container flex items-center justify-center bg-black'
const overlaidFrame = 'fixed inset-0 z-[100]'
// on a phone's page the stage runs to the screen's edges, past the page's px-6 gutter
const phoneBleed = 'phone:-mx-6'

type StageFrameProps = {
  frameRef: RefObject<HTMLDivElement | null>
  fullscreen: Fullscreen
  controls: StageControlsState
  // width over height of the stage, which keeps its shape on any screen
  aspect: number
  children: ReactNode
}

/** What fills the screen in fullscreen, around the stage, which takes the pointer like a video does. */
export function StageFrame({ frameRef, fullscreen, controls, aspect, children }: StageFrameProps) {
  const frameLook = fullscreen.isOn ? `${fullscreenFrame} ${fullscreen.isOverlay ? overlaidFrame : ''}` : ''
  // letterboxed: as wide as the screen, or as wide as its height allows at the stage's own shape
  const stageSize = fullscreen.isOn ? { width: `min(100%, calc(100dvh * ${aspect}))` } : undefined
  // the pointer goes with the controls over a stage that fills the screen, as over a video
  const isPointerHidden = fullscreen.isOn && !controls.isShown
  const stageLook = fullscreen.isOn ? '' : phoneBleed

  const frame = (
    <div ref={frameRef} className={`min-w-0 ${frameLook}`}>
      {/* moving over the stage shows the controls, a press on it plays or pauses */}
      <div {...controls.stage} style={stageSize} className={`${stageLook} ${isPointerHidden ? 'cursor-none' : ''}`}>
        {children}
      </div>
    </div>
  )

  // a transformed ancestor, like the wide page's centring, would hold a fixed frame inside itself instead of the
  // screen, so the overlay hangs from the body
  return fullscreen.isOverlay ? createPortal(frame, document.body) : frame
}
