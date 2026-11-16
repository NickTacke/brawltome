import { type MouseEvent, useRef, useState } from 'react'

// where the pointer is over a plot that spans the match from left to right: a share of the way along, and the pixels
export type PlotHover = { share: number; leftPx: number }

/** Follows the pointer over a plot of the match; nothing while it is off the plot. */
export function usePlotHover() {
  const plotRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<PlotHover | null>(null)

  function track(event: MouseEvent) {
    const box = plotRef.current?.getBoundingClientRect()

    if (!box || box.width === 0 || event.clientX < box.left || event.clientX > box.right) {
      setHover(null)

      return
    }

    const leftPx = event.clientX - box.left

    setHover({ share: leftPx / box.width, leftPx })
  }

  return { plotRef, hover, track, clear: () => setHover(null) }
}
