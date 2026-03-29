import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'

export function useContentBounds<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const report = () => {
      const rect = el.getBoundingClientRect()
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

    return () => observer.disconnect()
  }, [])

  return ref
}
