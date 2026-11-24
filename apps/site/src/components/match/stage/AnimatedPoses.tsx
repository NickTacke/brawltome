import type { StageBox } from '@brawltome/contracts'
import { useEffect, useRef } from 'react'
import type { DrawnMatch } from './draw-moment'
import { LegendTags } from './LegendTags'
import { missingPosesInFrame } from './missing-poses'
import type { Camera } from './play-camera'
import type { Pose } from './pose'
import { StageSpinner } from './StageSpinner'
import { type StagePlayer, TokenPoses } from './TokenPoses'
import { useCanvasSize } from './use-canvas-size'
import { useHeldFor } from './use-held-for'
import { useMomentDrawing } from './use-moment-drawing'

// a wait shorter than this shows no spinner, as a sheet often comes in a frame or two late
const spinnerDelayMs = 250

type AnimatedPosesProps = {
  match: DrawnMatch
  poses: Pose[]
  players: StagePlayer[]
  // the players whose art can't load, drawn as their portraits where their legends would be, in view or in a bubble
  missingSlots: ReadonlySet<number>
  selectedSlot: number
  box: StageBox
  camera: Camera
  timeMs: number
  // true while the moment on screen can't be drawn whole, so the clock waits for its art
  onBuffering: (isBuffering: boolean) => void
}

/**
 * Draws each player as their animated legend on a canvas over the stage, with their weapon, damage and stocks above
 * them. A player whose art can't load is drawn as their portrait instead, where their legend would be.
 */
export function AnimatedPoses(props: AnimatedPosesProps) {
  const { match, poses, players, missingSlots, selectedSlot, box, camera, timeMs, onBuffering } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // the canvas covers the frame, so its size on screen is the frame's
  const frame = useCanvasSize(canvasRef)
  const isBuffering = useMomentDrawing({ canvasRef, canvasSize: frame, match, camera, timeMs })
  const isSpinnerShown = useHeldFor(isBuffering, spinnerDelayMs)
  const drawnPoses = poses.filter((pose) => !missingSlots.has(pose.slot))
  const missingPoses = missingPosesInFrame(poses, missingSlots, match.timeline, box, camera, timeMs)

  useEffect(() => onBuffering(isBuffering), [isBuffering, onBuffering])

  // a stage that goes away mid-wait leaves the clock free
  useEffect(() => () => onBuffering(false), [onBuffering])

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
      <TokenPoses poses={missingPoses} players={players} selectedSlot={selectedSlot} hasTags={false} />
      <LegendTags
        poses={drawnPoses}
        portraits={missingPoses}
        selectedSlot={selectedSlot}
        box={box}
        camera={camera}
        frame={frame}
      />
      {isSpinnerShown ? <StageSpinner label="Loading the art for this moment" /> : null}
    </>
  )
}
