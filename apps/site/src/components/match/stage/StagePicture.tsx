import type { Stage, StageTrail } from '@brawltome/contracts'
import { useId } from 'react'
import { slotColour } from '../match-styles'
import { StageGround, stageWidth } from './StageGround'

// a part of the match, for drawing where players stood only then
export type TimeWindow = { fromMs: number; toMs: number }

// a soft dot per position sample; where a player stayed the dots pile up
const dotRadius = 3
const dotOpacity = 0.07
// a second, smaller and fainter pass in white: only where a player really lived does it add up, so the busiest
// spots turn light whatever colour the player has
const coreRadius = 1.5
const coreOpacity = 0.025
const blurRadius = 1.8
// piled-up dots run from barely there to solid, which would leave most of the map invisible beside the busiest
// spot. a gamma curve lifts the faint end and holds the top just short of solid, so the art still shows through
const densityCurve = { exponent: 0.6, amplitude: 0.85 }
// the art is bright and colourful, and the data on top of it is not: the background is greyed and darkened so marks
// and density read the same on a sunset as on a night sky
const backgroundTone = 'saturate(0.25) brightness(0.45)'
// one player's density takes the page's accent; several each take their own colour, so they can be told apart
const onePlayerColour = 'var(--color-primary)'

type StagePictureProps = {
  stage: Stage
  // the players whose positions are drawn as a density; empty when another layer is shown
  trails: StageTrail[]
  shownSlots: number[]
  window: TimeWindow | null
}

/**
 * The map's background as the game draws it: in its own layer under the level, scaled once to cover the frame with
 * two pixels to spare on each side from its top left, and never moved by the camera. Only the level zooms and pans.
 */
export function StageBackdrop({ imageUrl }: { imageUrl: string }) {
  return (
    <img
      src={imageUrl}
      alt=""
      className="pointer-events-none absolute -top-px -left-px h-[calc(100%+4px)] w-[calc(100%+4px)] max-w-none object-cover object-left-top"
      style={{ filter: backgroundTone }}
    />
  )
}

function isWithin(timeMs: number, window: TimeWindow | null): boolean {
  return window === null || (timeMs >= window.fromMs && timeMs <= window.toMs)
}

type TrailProps = { trail: StageTrail; colour: string; height: number; window: TimeWindow | null; blurId: string }

function Trail({ trail, colour, height, window, blurId }: TrailProps) {
  const spots = trail.spots.filter(([timeMs]) => isWithin(timeMs, window))

  return (
    <g filter={`url(#${blurId})`}>
      <g fill={colour}>
        {spots.map(([timeMs, x, y]) => (
          <circle key={timeMs} cx={x * stageWidth} cy={y * height} r={dotRadius} opacity={dotOpacity} />
        ))}
      </g>
      <g fill="white">
        {spots.map(([timeMs, x, y]) => (
          <circle key={timeMs} cx={x * stageWidth} cy={y * height} r={coreRadius} opacity={coreOpacity} />
        ))}
      </g>
    </g>
  )
}

/** The visible part of the stage: its platforms and walls, and where the shown players spent their time. */
export function StagePicture({ stage, trails, shownSlots, window }: StagePictureProps) {
  const blurId = useId()
  const height = stageWidth / stage.aspect
  const colourOf = (slot: number) => (shownSlots.length > 1 ? slotColour(slot) : onePlayerColour)

  return (
    <svg
      viewBox={`0 0 ${stageWidth} ${height}`}
      className="block w-full"
      role="img"
      aria-label="The match on its stage"
    >
      <defs>
        <filter id={blurId} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={blurRadius} />
          <feComponentTransfer>
            <feFuncA type="gamma" exponent={densityCurve.exponent} amplitude={densityCurve.amplitude} />
          </feComponentTransfer>
        </filter>
      </defs>
      <StageGround stage={stage} height={height} />
      {trails.map((trail) => (
        <Trail
          key={trail.slot}
          trail={trail}
          colour={colourOf(trail.slot)}
          height={height}
          window={window}
          blurId={blurId}
        />
      ))}
    </svg>
  )
}
