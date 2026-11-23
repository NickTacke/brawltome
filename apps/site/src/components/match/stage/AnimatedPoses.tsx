import type { StageBox } from '@brawltome/contracts'
import { useEffect, useRef } from 'react'
import type { DrawnMatch } from './draw-moment'
import { LegendTags } from './LegendTags'
import type { Camera } from './play-camera'
import type { Pose } from './pose'
import { StageSpinner } from './StageSpinner'
import { useHeldFor } from './use-held-for'
import { useMomentDrawing } from './use-moment-drawing'

// a wait shorter than this shows no spinner, as a sheet often comes in a frame or two late
const spinnerDelayMs = 250

// the canvas covers the frame, so its size on screen is the frame's
function frameOf(canvas: HTMLCanvasElement | null): { width: number; height: number } | null {
  return canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null
}

type AnimatedPosesProps = {
  match: DrawnMatch
  poses: Pose[]
  selectedSlot: number
  box: StageBox
  camera: Camera
  timeMs: number
  // true while the moment on screen can't be drawn whole, so the clock waits for its art
  onBuffering: (isBuffering: boolean) => void
}

/** Draws each player as their animated legend on a canvas over the stage, with their weapon, damage and stocks above them. */
export function AnimatedPoses({ match, poses, selectedSlot, box, camera, timeMs, onBuffering }: AnimatedPosesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isBuffering = useMomentDrawing({ canvasRef, match, camera, timeMs })
  const isSpinnerShown = useHeldFor(isBuffering, spinnerDelayMs)

  useEffect(() => onBuffering(isBuffering), [isBuffering, onBuffering])

  // a stage that goes away mid-wait leaves the clock free
  useEffect(() => () => onBuffering(false), [onBuffering])

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
      <LegendTags
        poses={poses}
        selectedSlot={selectedSlot}
        box={box}
        camera={camera}
        frame={frameOf(canvasRef.current)}
      />
      {isSpinnerShown ? <StageSpinner label="Loading the art for this moment" /> : null}
    </>
  )
}
