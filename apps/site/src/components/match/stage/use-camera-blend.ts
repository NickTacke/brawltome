import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Camera, clamp } from './play-camera'

// changing the camera swaps the path it follows, and the two paths can be far apart at that moment. instead of
// cutting, the view glides from where it was onto the new path. a seek still cuts, as the picture changes there anyway

const blendMs = 450

type Blend = { from: Camera; startMs: number }

// slow at both ends, so the glide neither starts nor stops with a jolt
function easeInOut(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}

function middleOf(camera: Camera, corner: number): number {
  return corner + 0.5 / camera.zoom
}

/** A camera part of the way to another: the middle of the view moves evenly and the zoom by equal ratios. */
export function mixCameras(from: Camera, to: Camera, progress: number): Camera {
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * progress)
  const middleX = middleOf(from, from.x) + (middleOf(to, to.x) - middleOf(from, from.x)) * progress
  const middleY = middleOf(from, from.y) + (middleOf(to, to.y) - middleOf(from, from.y)) * progress
  const shown = 1 / zoom

  return { x: clamp(middleX - shown / 2, 0, 1 - shown), y: clamp(middleY - shown / 2, 0, 1 - shown), zoom }
}

/** The camera to show: the one given, except for a short glide onto it whenever `source` changes. */
export function useCameraBlend(camera: Camera, source: string): Camera {
  const shown = useRef(camera)
  const [blendSource, setBlendSource] = useState(source)
  const [blend, setBlend] = useState<Blend | null>(null)
  const [, setFrame] = useState(0)

  // a new source starts a glide from the camera last on screen
  if (source !== blendSource) {
    setBlendSource(source)
    setBlend({ from: shown.current, startMs: performance.now() })
  }

  const progress = blend ? (performance.now() - blend.startMs) / blendMs : 1
  const isBlending = blend !== null && progress < 1
  const result = blend && isBlending ? mixCameras(blend.from, camera, easeInOut(clamp(progress, 0, 1))) : camera

  useLayoutEffect(() => {
    shown.current = result
  })

  // a paused clock draws no new frames, so the glide asks for its own until it is done
  useEffect(() => {
    if (!blend) return

    if (!isBlending) return setBlend(null)

    const frame = requestAnimationFrame(() => setFrame((count) => count + 1))

    return () => cancelAnimationFrame(frame)
  })

  return result
}
