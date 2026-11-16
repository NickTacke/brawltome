import { type RefObject, useEffect, useState } from 'react'

// the gap kept above a column that fits the screen, and under one that doesn't
const gapPx = 40
const bottomGapPx = 24

/**
 * Where a side column sticks. One that fits the screen sticks under the top; a taller one scrolls along until its
 * end is in view and sticks there, so it never leaves a hole next to a longer column.
 */
export function useStickyTop(columnRef: RefObject<HTMLElement | null>): number {
  const [topPx, setTopPx] = useState(gapPx)

  useEffect(() => {
    const column = columnRef.current

    if (!column) return

    const measure = () => setTopPx(Math.min(gapPx, window.innerHeight - column.offsetHeight - bottomGapPx))
    const observer = new ResizeObserver(measure)

    observer.observe(column)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [columnRef])

  return topPx
}
