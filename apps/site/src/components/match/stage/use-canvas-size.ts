import { type RefObject, useEffect, useState } from 'react'

/**
 * Keeps a canvas's pixels matching its size on screen, so what it draws stays sharp. The number it gives changes on
 * every resize, so a drawing that depends on it runs again.
 */
export function useCanvasSize(canvasRef: RefObject<HTMLCanvasElement | null>): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const observer = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1

      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
      setVersion((current) => current + 1)
    })

    observer.observe(canvas)

    return () => observer.disconnect()
  }, [canvasRef])

  return version
}
