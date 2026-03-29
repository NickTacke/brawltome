import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'

export function useContentBounds<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let lastX = 0
    let lastY = 0
    let lastW = 0
    let lastH = 0

    const report = () => {
      const rect = el.getBoundingClientRect()
      // Only invoke if bounds actually changed
      if (rect.x === lastX && rect.y === lastY && rect.width === lastW && rect.height === lastH) {
        return
      }
      lastX = rect.x
      lastY = rect.y
      lastW = rect.width
      lastH = rect.height
      invoke('update_content_bounds', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })
    }

    // Report initially and on resize
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)

    // Poll for position changes (ResizeObserver doesn't detect moves)
    const interval = setInterval(report, 500)

    return () => {
      observer.disconnect()
      clearInterval(interval)
    }
  }, [])

  return ref
}
