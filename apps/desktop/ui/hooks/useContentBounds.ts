import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'

export function useContentBounds<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) {
      invoke('update_content_bounds', { x: 0, y: 0, width: 0, height: 0 })
      return
    }

    let lastX = 0
    let lastY = 0
    let lastW = 0
    let lastH = 0

    const report = () => {
      const rect = el.getBoundingClientRect()
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

    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    const interval = setInterval(report, 500)

    return () => {
      observer.disconnect()
      clearInterval(interval)
    }
  }, [active])

  return ref
}
