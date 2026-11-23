import { type RefObject, useEffect, useState } from 'react'

/** A canvas's size on screen, in CSS pixels. */
export type CanvasSize = { width: number; height: number }

/**
 * Keeps a canvas's pixels matching its size on screen, so what it draws stays sharp, and gives that size: none until
 * the canvas is laid out. The size is read only when the canvas is resized, as reading it while rendering makes the
 * browser lay the page out again. A new size comes on every resize, so a drawing that depends on it runs again.
 */
export function useCanvasSize(canvasRef: RefObject<HTMLCanvasElement | null>): CanvasSize | null {
  const [size, setSize] = useState<CanvasSize | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const observer = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1

      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      setSize({ width: canvas.clientWidth, height: canvas.clientHeight })
    })

    observer.observe(canvas)

    return () => observer.disconnect()
  }, [canvasRef])

  return size
}
