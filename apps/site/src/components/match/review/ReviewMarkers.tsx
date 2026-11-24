import type { Moment, StageHit } from '@brawltome/contracts'
import type { CSSProperties } from 'react'
import { slotColour } from '../match-styles'
import { bodyRingStyle } from '../stage/body-ring'
import { useStageView } from '../stage/play-camera'
import type { Pose } from '../stage/pose'

// a pose is at the player's feet; the ring sits around the body, as big as the body is drawn
const ring = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full'

const hitNumber =
  'pointer-events-none absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/85 font-mono text-[0.6875rem] font-bold text-strong ring-1'

type ReviewMarkersProps = {
  moment: Moment
  poses: Pose[]
  // where each hit of the stop landed, in order; shown once the replay has stopped on it
  hits: StageHit[]
}

/** Rings that follow the two players of a stop, and the stop's hits numbered where they landed. */
export function ReviewMarkers({ moment, poses, hits }: ReviewMarkersProps) {
  // how the stage draws the players, which is how big the ring around one is
  const { bodies } = useStageView()

  const involved = poses.filter(
    (pose) => pose.isInPlay && (pose.slot === moment.victim || pose.slot === moment.attacker),
  )

  return (
    <>
      {involved.map((pose) => (
        <span
          key={pose.slot}
          className={`${ring} ${pose.slot === moment.victim ? 'border-2' : 'border border-dashed opacity-80'}`}
          style={{ ...bodyRingStyle(pose, bodies, pose.slot), borderColor: slotColour(pose.slot) }}
        />
      ))}
      {hits.map((hit, index) => (
        <span
          key={hit.timeMs}
          className={hitNumber}
          style={
            {
              left: `${hit.x * 100}%`,
              top: `${hit.y * 100}%`,
              '--tw-ring-color': slotColour(hit.attacker),
            } as CSSProperties
          }
        >
          {index + 1}
        </span>
      ))}
    </>
  )
}
