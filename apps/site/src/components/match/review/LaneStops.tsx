import type { Moment } from '@brawltome/contracts'
import { formatClock } from '../match-format'
import { slotColour } from '../match-styles'

// a stop and its place in the review
export type LaneStop = { stop: Moment; position: number }

type LaneStopsProps = {
  stops: LaneStop[]
  index: number
  durationMs: number
  onGoTo: (position: number) => void
}

// a tick across the stock bar, a KO's a little wider; ticks stay apart where round marks would pile up
function tickWidth(stop: Moment): string {
  return stop.knockout ? 'w-1.5' : 'w-1'
}

function tickLook(position: number, index: number): string {
  if (position === index) return 'z-20 scale-x-150 ring-2 ring-strong'

  return position < index ? 'opacity-40 ring-1 ring-ink' : 'ring-1 ring-ink'
}

/**
 * The stops of the review on the stock bar of the player who got hit, at the hit each one explains and in the colour
 * of who landed it. The ones behind fade, the current one is ringed, a click heads for one.
 */
export function LaneStops({ stops, index, durationMs, onGoTo }: LaneStopsProps) {
  return stops.map(({ stop, position }) => (
    <button
      key={stop.key}
      type="button"
      aria-label={`Stop ${position + 1} at ${formatClock(stop.timeMs)}`}
      aria-current={position === index}
      onClick={() => onGoTo(position)}
      // over the scrubber, which covers the whole lane: a press on a tick is the tick's
      className={`absolute bottom-1 z-10 h-4 -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-full transition before:absolute before:-inset-x-0.5 before:-inset-y-1.5 hover:z-20 hover:scale-x-150 hover:opacity-100 ${tickWidth(stop)} ${tickLook(position, index)}`}
      style={{
        left: `${(stop.timeMs / durationMs) * 100}%`,
        backgroundColor: slotColour(stop.attacker ?? stop.victim),
      }}
    />
  ))
}
