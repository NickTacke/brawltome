import { Maximize, Minimize } from 'lucide-react'
import type { ReactNode } from 'react'
import { LanesPanel, onStage, shownOnStage, stageControlsGroup, TransportCorner } from './StageControls'
import type { Fullscreen } from './use-fullscreen'
import type { StageControlsState } from './use-stage-controls'

// always in the stage's top right corner, with the rest of the controls
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
      className={`absolute top-2 right-2 flex size-8 cursor-pointer items-center justify-center text-soft hover:text-strong ${onStage} ${shownOnStage(controls.isShown)}`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  )
}

type StageDeckProps = {
  controls: StageControlsState
  fullscreen: Fullscreen
  // the three parts of the panel, in the order they lie in it
  transport: ReactNode
  timeline: ReactNode
  speed: ReactNode
  // while the stage fills the screen, the tools the page has over it come onto it
  tools: ReactNode
  // what the stage says about its legends, under the tools so the two never lie on each other
  note: ReactNode
}

type TopLeftProps = Pick<StageDeckProps, 'controls' | 'fullscreen' | 'tools' | 'note'>

// the note stays while the controls put themselves away; the tools come and go above it
function TopLeftCorner({ controls, fullscreen, tools, note }: TopLeftProps) {
  return (
    <div data-stage-top-left className="absolute top-2 left-2 flex flex-col items-start gap-1">
      {fullscreen.isOn ? <div className={`px-2 py-1 ${onStage} ${shownOnStage(controls.isShown)}`}>{tools}</div> : null}
      {note}
    </div>
  )
}

/**
 * What lies on the stage over the players: the transport in its corner, the lanes along the bottom, the fullscreen
 * button in the top right corner, and in the top left the note on the legends under the page's tools in fullscreen.
 * The lanes are always there.
 */
export function StageDeck(props: StageDeckProps) {
  const { controls, fullscreen, transport, timeline, speed } = props

  return (
    <div data-stage-controls-group className={stageControlsGroup}>
      <TopLeftCorner controls={controls} fullscreen={fullscreen} tools={props.tools} note={props.note} />
      <FullscreenButton fullscreen={fullscreen} controls={controls} />
      <LanesPanel isShown={controls.isShown} edge="bottom" bar={controls.bar} timeline={timeline} speed={speed} />
      <TransportCorner isShown={controls.isShown} isPartOfBar bar={controls.bar}>
        {transport}
      </TransportCorner>
    </div>
  )
}
