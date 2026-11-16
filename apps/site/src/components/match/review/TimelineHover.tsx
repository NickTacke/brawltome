import type { MatchInsights } from '@brawltome/contracts'
import type { Timeline } from '@brawltome/replay-player'
import { posesAt } from '../stage/pose'
import type { LanePlayer } from './lane-players'
import { TimelineReadout } from './TimelineReadout'
import { pointerTimeMs } from './timeline-readout'
import type { PlotHover } from './use-plot-hover'

// how close, as a share of the match, the pointer has to be to an exchange or a KO to read it out
const reachShare = 0.006

type TimelineHoverProps = {
  hover: PlotHover
  insights: MatchInsights
  lanes: LanePlayer[]
  timeline: Timeline | null
  selectedSlot: number
  // under the timeline when it lies along the stage's top edge, over it otherwise
  opensBelow: boolean
}

// as wide as what it says, however near the timeline's end it is placed; on a phone no wider than the timeline,
// where its players wrap onto a second line
const readoutWidth = 'w-max phone:max-w-full'

/**
 * The readout at the pointer. It slides along with it and is held by the same share of its own width, so it reaches
 * neither end of the timeline before the pointer does and never leaves it.
 */
export function TimelineHover({ hover, insights, lanes, timeline, selectedSlot, opensBelow }: TimelineHoverProps) {
  const { moments, knockouts, stage } = insights.insights
  const timeMs = pointerTimeMs(hover.share, stage.durationMs, stage.stepMs)
  const reachMs = stage.durationMs * reachShare
  const near = moments.filter((moment) => Math.abs(moment.timeMs - timeMs) <= reachMs)
  const moment = near.find((entry) => entry.victim === selectedSlot || entry.attacker === selectedSlot) ?? near[0]
  const knockout = knockouts.find((entry) => Math.abs(entry.timeMs - timeMs) <= reachMs * 2)
  const poses = timeline ? posesAt(timeline, stage.box, timeMs) : []
  const leftShare = hover.share * 100

  return (
    <div
      className={`pointer-events-none absolute z-40 ${readoutWidth} ${opensBelow ? 'top-full pt-2' : 'bottom-full pb-2'}`}
      style={{ left: `${leftShare}%`, transform: `translateX(-${leftShare}%)` }}
    >
      <TimelineReadout
        timeMs={timeMs}
        lanes={lanes}
        poses={poses}
        moment={moment ?? null}
        knockout={knockout ?? null}
      />
    </div>
  )
}
