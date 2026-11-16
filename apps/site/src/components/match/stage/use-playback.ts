import { useEffect, useRef, useState } from 'react'

export const playbackSpeeds = [0.5, 1, 2, 4]

// a hidden tab gets no animation frames, so the first one back can come minutes later; the clock moves no further
// than this in one frame, as if it had waited too
const longestFrameMs = 100

/** How far the clock moves in a frame: the time since the last one, none on the first, and never a jump. */
export function frameElapsedMs(nowMs: number, lastFrameMs: number | null): number {
  if (lastFrameMs === null) return 0

  return Math.min(nowMs - lastFrameMs, longestFrameMs)
}

/** A match clock: it runs on animation frames while playing, at the chosen speed, and stops at the end. */
export function usePlayback(durationMs: number) {
  const [timeMs, setTimeMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  // holds the clock while the frame it would show can't be drawn yet, as a video holds while it buffers
  const [isBuffering, setIsBuffering] = useState(false)
  const lastFrameMs = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying || isBuffering) return

    let frame = 0

    function tick(nowMs: number) {
      const elapsedMs = frameElapsedMs(nowMs, lastFrameMs.current)

      lastFrameMs.current = nowMs
      setTimeMs((current) => Math.min(current + elapsedMs * speed, durationMs))
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      lastFrameMs.current = null
    }
  }, [isPlaying, isBuffering, speed, durationMs])

  // playing on from the end starts over
  function toggle() {
    if (!isPlaying && timeMs >= durationMs) setTimeMs(0)

    setIsPlaying(!isPlaying)
  }

  function seek(nextMs: number) {
    setTimeMs(Math.min(Math.max(nextMs, 0), durationMs))
  }

  const isAtEnd = timeMs >= durationMs

  return {
    timeMs,
    durationMs,
    isPlaying: isPlaying && !isAtEnd,
    speed,
    toggle,
    seek,
    setSpeed,
    isBuffering,
    setIsBuffering,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
  }
}

export type Playback = ReturnType<typeof usePlayback>
