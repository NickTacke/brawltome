import type { ReactNode, RefObject } from 'react'
import type { StageControlsState } from './use-stage-controls'

// what lies on the stage reads against any background: a dark, blurred panel with a thin edge
export const onStage = 'rounded-lg bg-ink/85 ring-1 ring-line/70 backdrop-blur-sm'

// w-[7.25rem] on the transport, with left-2 before it and a gap after it: where the lanes start along the bottom
export const transportCornerPx = { width: 132, height: 84 }

// around everything of the controls on the stage, so keyboard focus in one part brings all of them back. it lets the
// pointer through to the stage; the parts take it themselves
export const stageControlsGroup = 'group/controls pointer-events-none absolute inset-0 z-20'

const shownByKeyboard =
  'group-has-[:focus-visible]/controls:pointer-events-auto group-has-[:focus-visible]/controls:opacity-100'

/**
 * How a part of the controls looks while they show, and put away while the replay plays undisturbed. Put away, it can
 * still be reached with the keyboard: all of them come back as soon as the keyboard puts focus in one. Focus left
 * behind by a click doesn't count, or pressing play would keep them up.
 */
export function shownOnStage(isShown: boolean): string {
  const shown = isShown ? 'pointer-events-auto' : 'pointer-events-none opacity-0'

  return `transition duration-200 ${shownByKeyboard} ${shown}`
}

type TransportCornerProps = {
  isShown: boolean
  // true while the lanes lie along the bottom: the corner is then the start of their bar, not a box of its own
  isPartOfBar: boolean
  bar: StageControlsState['bar']
  children: ReactNode
}

/**
 * The steps around play, with the clock, in the stage's bottom left corner. They never leave it, so a button pressed
 * from stop to stop stays under the pointer while the lanes move out of the players' way. With the lanes along the
 * bottom it is the head of one bar; with the lanes up, a box of its own.
 */
export function TransportCorner({ isShown, isPartOfBar, bar, children }: TransportCornerProps) {
  return (
    <div
      {...bar}
      data-stage-transport
      className={`absolute bottom-2 left-2 flex w-[7.25rem] justify-center py-2 ${isPartOfBar ? '' : onStage} ${shownOnStage(isShown)}`}
    >
      {children}
    </div>
  )
}

type LanesPanelProps = {
  panelRef?: RefObject<HTMLDivElement | null>
  isShown: boolean
  // along the top while the players of the frame stand where the panel usually lies
  edge: 'top' | 'bottom'
  bar: StageControlsState['bar']
  // told while the pointer rests on the panel
  onHeld?: (isHeld: boolean) => void
  timeline: ReactNode
  speed: ReactNode
}

/**
 * The lanes on the stage, with the speed after them. Along the bottom they are one bar with the transport, like a
 * video player's: the bar runs from edge to edge and leaves its head to the transport. Along the top they are a
 * panel of their own, which leaves the corner to the fullscreen button.
 */
export function LanesPanel({ panelRef, isShown, edge, bar, onHeld, timeline, speed }: LanesPanelProps) {
  const place =
    edge === 'top' ? 'top-2 left-2 right-12 items-start pl-2.5' : 'bottom-2 left-2 right-2 items-end pl-[7.75rem]'

  function hold(isHeld: boolean) {
    if (isHeld) bar.onPointerEnter()
    else bar.onPointerLeave()

    onHeld?.(isHeld)
  }

  return (
    <div
      ref={panelRef}
      data-stage-controls
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      className={`absolute flex gap-3 py-2 pr-2.5 ${onStage} ${place} ${shownOnStage(isShown)}`}
    >
      <div className="min-w-0 flex-1">{timeline}</div>
      {speed}
    </div>
  )
}
