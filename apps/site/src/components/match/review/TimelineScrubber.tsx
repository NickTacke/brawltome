import { type PointerEvent, useRef } from 'react'

type TimelineScrubberProps = {
  label: string
  timeMs: number
  durationMs: number
  onSeek: (timeMs: number) => void
  // true when the match runs from top to bottom instead of from left to right
  isUpright?: boolean
  title?: string
}

type Point = { x: number; y: number }

// how far a finger has moved along the scrubber and across it since it pressed
function movedFrom(start: Point, event: PointerEvent, isUpright: boolean): { along: number; across: number } {
  const movedX = Math.abs(event.clientX - start.x)
  const movedY = Math.abs(event.clientY - start.y)

  return isUpright ? { along: movedY, across: movedX } : { along: movedX, across: movedY }
}

/**
 * A plot of the whole match as one slider: click or drag anywhere on it to go there. A mouse goes there as it
 * presses. A finger may be starting to scroll the page, which the browser is left to do across the scrubber, so it
 * goes there once it moves along the scrubber, or where it lifts.
 */
export function TimelineScrubber({
  label,
  timeMs,
  durationMs,
  onSeek,
  isUpright = false,
  title,
}: TimelineScrubberProps) {
  // where a finger pressed, until it moves along the scrubber; null once it scrubs
  const fingerStart = useRef<Point | null>(null)

  function seekAt(event: PointerEvent<HTMLDivElement>) {
    const track = event.currentTarget.getBoundingClientRect()
    const share = isUpright ? (event.clientY - track.top) / track.height : (event.clientX - track.left) / track.width

    onSeek(share * durationMs)
  }

  function scrub(event: PointerEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return

    const start = fingerStart.current

    if (start) {
      const moved = movedFrom(start, event, isUpright)

      if (moved.along <= moved.across) return

      fingerStart.current = null
    }

    seekAt(event)
  }

  // the drag keeps hold of the pointer, so it goes on when the pointer leaves the plot
  function grab(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)

    if (event.pointerType === 'touch') {
      fingerStart.current = { x: event.clientX, y: event.clientY }

      return
    }

    seekAt(event)
  }

  function lift(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') seekAt(event)

    fingerStart.current = null
  }

  // the browser took the press over as a scroll of the page
  function cancel() {
    fingerStart.current = null
  }

  return (
    <div
      role="slider"
      tabIndex={-1}
      aria-label={label}
      aria-orientation={isUpright ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={Math.round(timeMs)}
      title={title}
      onPointerDown={grab}
      onPointerMove={scrub}
      onPointerUp={lift}
      onPointerCancel={cancel}
      className={`absolute inset-0 select-none ${isUpright ? 'cursor-row-resize touch-pan-x' : 'cursor-col-resize touch-pan-y'}`}
    />
  )
}
