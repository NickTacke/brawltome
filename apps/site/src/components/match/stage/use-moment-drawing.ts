import type { StageBox } from '@brawltome/contracts'
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import type { DrawnMatch } from './draw-moment'
import { type Camera, levelToCanvas, viewOf } from './play-camera'
import { stepAt } from './playback-timeline'
import { useStageTools } from './stage-tools'
import { useCanvasSize } from './use-canvas-size'

type MomentDrawing = {
  canvasRef: RefObject<HTMLCanvasElement | null>
  match: DrawnMatch
  box: StageBox
  camera: Camera
  timeMs: number
}

/**
 * Draws the moment at the clock on the canvas whenever it, the camera or the canvas's size changes. True while the
 * moment can't be drawn whole, as its art hasn't loaded: it is then tried again every frame until it can be.
 */
export function useMomentDrawing({ canvasRef, match, box, camera, timeMs }: MomentDrawing): boolean {
  // the step of the last frame drawn whole, which stays on screen while the next one waits for its art
  const lastWholeStep = useRef<number | null>(null)
  const sizeVersion = useCanvasSize(canvasRef)
  const { drawMoment } = useStageTools()
  const [isBuffering, setIsBuffering] = useState(false)
  const [retries, setRetries] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a resize or a retry means drawing the same moment again
  useLayoutEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const step = stepAt(match.timeline, timeMs)
    const framing = { transform: levelToCanvas(box, camera, canvas.width, canvas.height), view: viewOf(box, camera) }
    const isWhole = drawMoment(canvas, match, step, framing, lastWholeStep.current)

    if (isWhole) lastWholeStep.current = step

    setIsBuffering(!isWhole)

    // the art it waits for comes in on a later frame
    if (isWhole) return

    const frame = requestAnimationFrame(() => setRetries((current) => current + 1))

    return () => cancelAnimationFrame(frame)
  }, [canvasRef, timeMs, match, box, camera, sizeVersion, retries, drawMoment])

  return isBuffering
}
