import { LegendMark } from '../LegendMark'
import { type LaneStop, LaneStops } from './LaneStops'
import type { LanePlayer } from './lane-players'
import { StockLane } from './StockLane'

type PlayerLaneProps = {
  lane: LanePlayer
  // a little air above the first player of a team
  hasAirBefore: boolean
  durationMs: number
  stops: LaneStop[]
  stopIndex: number
  onGoTo: (position: number) => void
}

/**
 * One player's row of the timeline: their legend in their colour, their stocks, and the stops where they got hit.
 * The row is as high as the legend, which has to be told apart at a glance; the stocks lie along its bottom. It is
 * this high whatever the replay is doing: the lanes never shrink or go away.
 */
export function PlayerLane({ lane, hasAirBefore, durationMs, stops, stopIndex, onGoTo }: PlayerLaneProps) {
  const { player } = lane

  return (
    <div data-lane={player.slot} className={`relative h-6 ${hasAirBefore ? 'mt-1' : ''}`}>
      <LegendMark player={player} slot={player.slot} className="absolute top-0 right-full mr-3 size-6 rounded-md" />
      <StockLane stocks={lane.stocks} durationMs={durationMs} />
      <LaneStops stops={stops} index={stopIndex} durationMs={durationMs} onGoTo={onGoTo} />
    </div>
  )
}
