import type { MatchInsights, Moment } from '@brawltome/contracts'
import type { Timeline } from '@brawltome/replay-player'
import { type PointerEvent, useMemo } from 'react'
import { lanePlayersOf, startsSide } from './lane-players'
import { PlayerLane } from './PlayerLane'
import { TimelineHover } from './TimelineHover'
import { TimelineScrubber } from './TimelineScrubber'
import { usePlotHover } from './use-plot-hover'

// a line through every lane, with a knob on top to show it can be dragged
function Playhead({ share }: { share: number }) {
  return (
    <span
      className="pointer-events-none absolute -inset-y-1 z-20 w-0.5 -translate-x-1/2 rounded-full bg-strong before:absolute before:-top-1 before:left-1/2 before:size-1.5 before:-translate-x-1/2 before:rounded-full before:bg-strong"
      style={{ left: `${share * 100}%` }}
    />
  )
}

type MatchTimelineProps = {
  insights: MatchInsights
  // the playback timeline, for what each player holds in the readout; null until it loads
  timeline: Timeline | null
  selectedSlot: number
  timeMs: number
  onSeek: (timeMs: number) => void
  // the stops of a review, none while watching
  stops: Moment[]
  stopIndex: number
  onGoTo: (position: number) => void
  // the readout opens under the timeline when it lies along the stage's top edge
  opensBelow: boolean
}

/**
 * The replay's timeline and its scrubber: a lane per player with their stocks reddening with damage. A review puts
 * its stops on the stocks of whoever got hit.
 */
export function MatchTimeline(props: MatchTimelineProps) {
  const { insights, timeMs, stops } = props
  const { durationMs } = insights.insights.stage
  const lanes = useMemo(() => lanePlayersOf(insights), [insights])
  const { plotRef, hover, track, clear } = usePlotHover()
  const placed = stops.map((stop, position) => ({ stop, position }))

  // a mouse reads out where it rests, and not while it scrubs, as the stage then shows the moment itself. a finger
  // can't rest without pressing, so it reads out while it presses and scrubs, and lifting it puts the readout away
  function readOut(event: PointerEvent) {
    const isPressed = event.buttons !== 0
    const isReading = event.pointerType === 'mouse' ? !isPressed : isPressed

    if (isReading) track(event)
    else clear()
  }

  return (
    // a gutter before the lanes for who each one is
    <div className="relative mr-1 ml-9">
      {/* a pointer-only readout: the slider and the stops are controls of their own */}
      <div
        ref={plotRef}
        className="relative grid gap-0.5"
        onPointerDown={readOut}
        onPointerMove={readOut}
        onPointerUp={readOut}
        onPointerCancel={clear}
        onPointerLeave={clear}
      >
        {lanes.map((lane, index) => (
          <PlayerLane
            key={lane.player.slot}
            lane={lane}
            hasAirBefore={lanes.length > 2 && startsSide(lanes, index)}
            durationMs={durationMs}
            stops={placed.filter(({ stop }) => stop.victim === lane.player.slot)}
            stopIndex={props.stopIndex}
            onGoTo={props.onGoTo}
          />
        ))}
        <TimelineScrubber label="Match time" timeMs={timeMs} durationMs={durationMs} onSeek={props.onSeek} />
        {hover ? (
          <span className="pointer-events-none absolute inset-y-0 w-px bg-strong/40" style={{ left: hover.leftPx }} />
        ) : null}
        <Playhead share={timeMs / durationMs} />
      </div>
      {hover ? (
        <TimelineHover
          hover={hover}
          insights={insights}
          lanes={lanes}
          timeline={props.timeline}
          selectedSlot={props.selectedSlot}
          opensBelow={props.opensBelow}
        />
      ) : null}
    </div>
  )
}
