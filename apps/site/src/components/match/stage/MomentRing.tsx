import type { Moment } from '@brawltome/contracts'
import { slotColour } from '../match-styles'
import { bodyRingStyle, type DrawnBodies } from './body-ring'

// the ring stays a beat after the first hit, then the hit flashes take over
const afterHitMs = 300

type MomentRingProps = { moment: Moment | null; bodies: DrawnBodies; timeMs: number }

/**
 * A ring on the stage where the moment being watched is about to happen: around the body of whoever gets hit, as the
 * moment's spot is where their feet are at the first hit.
 */
export function MomentRing({ moment, bodies, timeMs }: MomentRingProps) {
  if (!moment?.spot) return null

  if (timeMs > moment.timeMs + afterHitMs) return null

  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-dashed"
      style={{ ...bodyRingStyle(moment.spot, bodies, moment.victim), borderColor: slotColour(moment.victim) }}
    />
  )
}
