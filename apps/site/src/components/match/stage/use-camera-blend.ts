import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Camera } from './play-camera'

// changing the camera swaps the path it follows, and the two paths can be far apart at that moment. instead of
// cutting, the view glides from where it was onto the new path. a seek still cuts, as the picture changes there anyway

const blendMs = 450

type Blend = { from: Camera; startMs: number }

// slow at both ends, so the glide neither starts nor stops with a jolt
function easeInOut(progress: number): number {
  return progress * progress * (3 - 2 * progress)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

function between(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

/** A camera part of the way to another: the middle of the view moves evenly and its size by equal ratios. */
export function mixCameras(from: Camera, to: Camera, progress: number): Camera {
  const width = from.width * (to.width / from.width) ** progress
  const height = from.height * (to.height / from.height) ** progress
  const middleX = between(from.x + from.width / 2, to.x + to.width / 2, progress)
  const middleY = between(from.y + from.height / 2, to.y + to.height / 2, progress)

  return { x: middleX - width / 2, y: middleY - height / 2, width, height }
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
