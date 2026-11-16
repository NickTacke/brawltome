import type { PointerEvent } from 'react'

type TimelineScrubberProps = {
  label: string
  timeMs: number
  durationMs: number
  onSeek: (timeMs: number) => void
}

/** A plot of the whole match as one slider: click or drag anywhere on it to go there. */
export function TimelineScrubber({ label, timeMs, durationMs, onSeek }: TimelineScrubberProps) {
  function scrub(event: PointerEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return

    const track = event.currentTarget.getBoundingClientRect()
    const share = (event.clientX - track.left) / track.width

    onSeek(share * durationMs)
  }

  // the drag keeps hold of the pointer, so it goes on when the pointer leaves the plot
  function grab(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    scrub(event)
  }

  return (
    <div
      role="slider"
      tabIndex={-1}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={Math.round(timeMs)}
      onPointerDown={grab}
      onPointerMove={scrub}
      className="absolute inset-0 cursor-col-resize touch-none select-none"
    />
  )
}
