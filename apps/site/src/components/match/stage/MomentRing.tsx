import type { Moment } from '@brawltome/contracts'
import { slotColour } from '../match-styles'

// the ring stays a beat after the first hit, then the hit flashes take over
const afterHitMs = 300

/** A ring on the stage where the moment being watched is about to happen. */
export function MomentRing({ moment, timeMs }: { moment: Moment | null; timeMs: number }) {
  if (!moment?.spot) return null

  if (timeMs > moment.timeMs + afterHitMs) return null

  return (
    <span
      className="pointer-events-none absolute size-16 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-dashed"
      style={{
        left: `${moment.spot.x * 100}%`,
        top: `${moment.spot.y * 100}%`,
        borderColor: slotColour(moment.victim),
      }}
    />
  )
}
