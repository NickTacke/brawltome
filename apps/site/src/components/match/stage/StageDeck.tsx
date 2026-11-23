import { Maximize, Minimize } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { FoldButton } from './ReviewControls'
import { LanesPanel, onStage, shownOnStage, stageControlsGroup, TransportCorner, underStage } from './StageControls'
import type { Fullscreen } from './use-fullscreen'
import type { LanesFold } from './use-lanes-fold'
import type { StageControlsState } from './use-stage-controls'

// in the stage's top right corner, with the rest of the controls; on a phone at the end of the row under the stage
const fullscreenPlace = 'absolute top-2 right-2 flex size-8 phone:col-start-3 phone:row-start-1 phone:size-11'

function FullscreenButton({ fullscreen, controls }: { fullscreen: Fullscreen; controls: StageControlsState }) {
  const Icon = fullscreen.isOn ? Minimize : Maximize
  const label = fullscreen.isOn ? 'Leave fullscreen' : 'Fullscreen'

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (F)`}
      onClick={fullscreen.toggle}
      {...controls.bar}
      className={`${fullscreenPlace} cursor-pointer items-center justify-center text-soft hover:text-strong ${onStage} ${shownOnStage(controls.isShown)} ${underStage}`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  )
}

// where the lanes lie, and what the page measures of them to keep a card beside them
export type LanesPlace = {
  edge: 'top' | 'bottom'
  panelRef?: RefObject<HTMLDivElement | null>
  // told while the pointer rests on the lanes
  onHeld?: (isHeld: boolean) => void
}

type StageDeckProps = {
  controls: StageControlsState
  fullscreen: Fullscreen
  lanes: LanesPlace
  // folded, the lanes are a thin bar in one low row with the transport
  fold: LanesFold
  // the three parts of the panel, in the order they lie in it; the timeline's readout opens away from the stage's edge
  transport: ReactNode
  timeline: (opensBelow: boolean) => ReactNode
  speed: ReactNode
  // while the stage fills the screen, the tools the page has over it come onto it
  tools: ReactNode
  // what the stage says about its legends, under the tools so the two never lie on each other
  note: ReactNode
  // measured, so a card on the stage keeps clear of the corner
  topLeftRef?: RefObject<HTMLDivElement | null>
  // a review's card, laid on the stage under the controls; on a phone under the lanes
  card?: ReactNode
}

type TopLeftProps = Pick<StageDeckProps, 'controls' | 'fullscreen' | 'tools' | 'note' | 'topLeftRef'>

// in fullscreen on a phone held upright the stage is too small to lie on, so the corner stands over it
const overStage = 'phone:top-auto phone:bottom-full phone:pb-2'

// the note stays while the controls put themselves away; the tools come and go above it
function TopLeftCorner({ controls, fullscreen, tools, note, topLeftRef }: TopLeftProps) {
  const place = fullscreen.isOn ? overStage : ''
  const toolsLook = `${onStage} ${shownOnStage(controls.isShown)} ${underStage}`

  return (
    <div
      ref={topLeftRef}
      data-stage-top-left
      className={`absolute top-2 left-2 flex flex-col items-start gap-1 ${place}`}
    >
      {fullscreen.isOn ? <div className={`px-2 py-1 ${toolsLook}`}>{tools}</div> : null}
      {note}
    </div>
  )
}

/**
 * What lies on the stage over the players: the transport in its corner, the lanes along an edge, the fullscreen
 * button in the top right corner, and in the top left the note on the legends under the page's tools in fullscreen.
 * At a review's stop a card lies under them. The lanes are always there, at full size, unless the viewer folds them
 * into a thin bar. On a phone held upright the stage is too small to lie on: the controls, the lanes and the card come
 * under it, in that order.
 */
export function StageDeck(props: StageDeckProps) {
  const { controls, fullscreen, lanes, fold } = props
  const isAlongTop = lanes.edge === 'top' && !fold.isFolded

  const ends = (
    <>
      {props.speed}
      <FoldButton fold={fold} isAlongTop={isAlongTop} />
    </>
  )

  return (
    <>
      <div data-stage-controls-group className={stageControlsGroup}>
        <TopLeftCorner
          controls={controls}
          fullscreen={fullscreen}
          tools={props.tools}
          note={props.note}
          topLeftRef={props.topLeftRef}
        />
        <FullscreenButton fullscreen={fullscreen} controls={controls} />
        {fold.isFolded ? null : (
          <TransportCorner isShown={controls.isShown} isPartOfBar={!isAlongTop} bar={controls.bar}>
            {props.transport}
          </TransportCorner>
        )}
        <LanesPanel
          panelRef={lanes.panelRef}
          isShown={controls.isShown}
          edge={lanes.edge}
          isFolded={fold.isFolded}
          bar={controls.bar}
          onHeld={lanes.onHeld}
          head={fold.isFolded ? props.transport : null}
          timeline={props.timeline(isAlongTop)}
          ends={ends}
        />
      </div>
      {props.card}
    </>
  )
}
