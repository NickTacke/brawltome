import type { StageBox, StageKo } from '@brawltome/contracts'
import { slotColour } from '../match-styles'
import { KoArrow } from './KoArrow'
import { type Camera, inFrame } from './play-camera'

// how long a KO's marker stays up
const koMarkerMs = 1800
// how far inside the frame's edges the marker's middle is kept, in shares of the frame, so the whole marker shows
const edgeMargin = { x: 0.015, y: 0.025 }

type FrameSpot = { x: number; y: number }

// which way a player left the picture, as a turn of a triangle that points up
function turnOf(ko: StageKo): number {
  if (ko.y <= 0) return 0

  if (ko.x >= 1) return 90

  return ko.y >= 1 ? 180 : 270
}

function keptInside(share: number, margin: number): number {
  return Math.min(Math.max(share, margin), 1 - margin)
}

/**
 * Where a KO's marker goes in the frame, in shares of the frame: where the game draws its KO burst. The game puts the
 * burst in the level, at the player's position kept inside the level's camera bounds (`TrailEffect._-DK` in 11.00),
 * and a KO's spot is that place already: the stage box is those bounds when the level's layout is known, and a spot
 * past them lies on its edge. The marker is only kept a little inside the frame, so it shows whole when the camera
 * has that place on its edge or past it.
 *
 * The game also keeps the burst above a level's mud line, which only Shrek's Muddy Swamp has. The marker doesn't,
 * as the mud line isn't in the stage data.
 */
export function koSpotInFrame(ko: StageKo, box: StageBox, camera: Camera): FrameSpot {
  const burst = inFrame(ko, box, camera)

  return { x: keptInside(burst.x, edgeMargin.x), y: keptInside(burst.y, edgeMargin.y) }
}

function KoMarker({ ko, spot }: { ko: StageKo; spot: FrameSpot }) {
  return (
    <span
      data-ko-marker
      className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
    >
      <KoArrow colour={slotColour(ko.victim)} turnDeg={turnOf(ko)} className="size-4" />
    </span>
  )
}

type KoMarkersProps = { kos: StageKo[]; box: StageBox; camera: Camera; timeMs: number }

/**
 * A marker where a player just went out at the playback clock. It is laid out on the frame, not on the stage as the
 * hit flashes are, so it can be kept inside the frame: the game's camera has the edge a player went out by on the
 * edge of its view, or past it.
 */
export function KoMarkers({ kos, box, camera, timeMs }: KoMarkersProps) {
  const recentKos = kos.filter((ko) => timeMs >= ko.timeMs && timeMs - ko.timeMs < koMarkerMs)

  return (
    <>
      {recentKos.map((ko) => (
        <KoMarker key={`${ko.victim}-${ko.timeMs}`} ko={ko} spot={koSpotInFrame(ko, box, camera)} />
      ))}
    </>
  )
}
