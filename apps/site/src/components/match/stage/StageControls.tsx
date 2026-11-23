import type { ReactNode, RefObject } from 'react'
import type { StageControlsState } from './use-stage-controls'

// what lies on the stage reads against any background: a dark, blurred panel with a thin edge
export const onStage = 'rounded-lg bg-ink/85 ring-1 ring-line/70 backdrop-blur-sm'

// w-[7.25rem] on the transport, with left-2 before it and a gap after it: where the lanes start along the bottom
export const transportCornerPx = { width: 132, height: 84 }

// around everything of the controls on the stage, so keyboard focus in one part brings all of them back. it lets the
// pointer through to the stage; the parts take it themselves. on a phone it is a row of the transport, the speed and
// fullscreen under the stage, with the lanes under that. px-6 is the page's gutter, as the stage runs to the edges
export const stageControlsGroup =
  'group/controls pointer-events-none absolute inset-0 z-20 phone:static phone:grid phone:grid-cols-[1fr_auto_auto] phone:items-center phone:gap-x-1 phone:px-6 phone:pt-1'

// a part of the controls under the stage on a phone: in the page's flow, flat on it, and always in sight
export const underStage =
  'phone:static phone:pointer-events-auto phone:opacity-100 phone:bg-transparent phone:ring-0 phone:backdrop-blur-none'

const shownByKeyboard =
  'group-has-[:focus-visible]/controls:pointer-events-auto group-has-[:focus-visible]/controls:opacity-100'

// an open menu among them, as the camera's, would go with them while the viewer reads it
const shownByMenu =
  'group-has-[[aria-expanded=true]]/controls:pointer-events-auto group-has-[[aria-expanded=true]]/controls:opacity-100'

/**
 * How a part of the controls looks while they show, and put away while the replay plays undisturbed. Put away, it can
 * still be reached with the keyboard: all of them come back as soon as the keyboard puts focus in one. Focus left
 * behind by a click doesn't count, or pressing play would keep them up. An open menu keeps them up too. They fade,
 * or with less motion asked for, come and go at once.
 */
export function shownOnStage(isShown: boolean): string {
  const shown = isShown ? 'pointer-events-auto' : 'pointer-events-none opacity-0'

  return `transition duration-200 motion-reduce:transition-none ${shownByKeyboard} ${shownByMenu} ${shown}`
}

type TransportCornerProps = {
  isShown: boolean
  // true while the lanes lie along the bottom: the corner is then the start of their bar, not a box of its own
  isPartOfBar: boolean
  // the head of the low bar of folded lanes, as one row
  isFolded: boolean
  bar: StageControlsState['bar']
  children: ReactNode
}

// over the lanes' panel, which it heads along the bottom; on a phone the start of the row under the stage
const transportPlace =
  'absolute bottom-2 left-2 z-10 flex phone:col-start-1 phone:row-start-1 phone:w-auto phone:justify-start phone:py-1 phone:pl-0'

// w-[13rem] holds the steps beside the longest clock, or a review's time and stop count, so the bar never moves
const transportSizes = {
  column: 'w-[7.25rem] justify-center py-2',
  row: 'w-[13rem] justify-start py-1.5 pl-2',
}

/**
 * The steps around play, with the clock, in the stage's bottom left corner. They never leave it, so a button pressed
 * from stop to stop stays under the pointer while the lanes move out of the players' way. With the lanes along the
 * bottom it is the head of one bar; with the lanes up, a box of its own. Folding the lanes only reshapes it: it stays
 * the same element, so it keeps keyboard focus and still hears the pointer leave.
 */
export function TransportCorner({ isShown, isPartOfBar, isFolded, bar, children }: TransportCornerProps) {
  const size = isFolded ? transportSizes.row : transportSizes.column

  return (
    <div
      {...bar}
      data-stage-transport
      className={`${transportPlace} ${size} ${isPartOfBar ? '' : onStage} ${shownOnStage(isShown)} ${underStage}`}
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
  // folded down to one low row along the bottom, headed by the transport
  isFolded: boolean
  bar: StageControlsState['bar']
  // told while the pointer rests on the panel
  onHeld?: (isHeld: boolean) => void
  timeline: ReactNode
  // after the lanes: the speed and the button that folds them
  ends: ReactNode
}

// pl-[7.75rem] and pl-[13.5rem] leave the head of the bar along the bottom to the transport corner
const panelPlaces = {
  top: 'top-2 left-2 right-12 items-start py-2 pl-2.5',
  bottom: 'bottom-2 left-2 right-2 items-end py-2 pl-[7.75rem]',
  folded: 'bottom-2 left-2 right-2 items-center py-1.5 pl-[13.5rem]',
}

/**
 * The lanes on the stage, with the speed after them. Along the bottom they are one bar with the transport, like a
 * video player's: the bar runs from edge to edge and leaves its head to the transport. Along the top they are a
 * panel of their own, which leaves the corner to the fullscreen button. Folded, the lanes are a thin line in a low
 * bar that the transport heads. On a phone the panel gives its parts to the rows under the stage: the lanes take the
 * whole width under them, the ends fall into the row of the transport.
 */
export function LanesPanel(props: LanesPanelProps) {
  const { panelRef, isShown, edge, isFolded, bar, onHeld } = props
  const place = isFolded ? panelPlaces.folded : panelPlaces[edge]

  function hold(isHeld: boolean) {
    if (isHeld) bar.onPointerEnter()
    else bar.onPointerLeave()

    onHeld?.(isHeld)
  }

  return (
    <div
      ref={panelRef}
      data-stage-controls
      data-folded={isFolded}
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      className={`absolute flex gap-3 pr-2.5 ${onStage} ${place} ${shownOnStage(isShown)} ${underStage} phone:contents`}
    >
      <div className="min-w-0 flex-1 phone:col-span-full phone:row-start-2 phone:pt-2 phone:pb-1">{props.timeline}</div>
      {/* one cell of the row under the stage on a phone */}
      <div className="flex shrink-0 items-center gap-0.5">{props.ends}</div>
    </div>
  )
}
