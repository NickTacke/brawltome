import { type RefObject, useEffect, useState } from 'react'

/**
 * Fills the screen with an element. Where the browser can't do that for an element, as Safari on an iPhone can't,
 * the element is laid over the whole page instead; the caller styles it for that, and for the real thing.
 */
export function useFullscreen(elementRef: RefObject<HTMLElement | null>) {
  const [isNative, setIsNative] = useState(false)
  const [isOverlay, setIsOverlay] = useState(false)

  // the browser leaves fullscreen on its own too, on Escape, so the state follows its event
  useEffect(() => {
    const read = () =>
      setIsNative(document.fullscreenElement !== null && document.fullscreenElement === elementRef.current)

    document.addEventListener('fullscreenchange', read)

    return () => document.removeEventListener('fullscreenchange', read)
  }, [elementRef])

  // the page behind an overlay must not scroll
  useEffect(() => {
    if (!isOverlay) return

    const previous = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
    }
  }, [isOverlay])

  function enter() {
    const element = elementRef.current

    if (!element) return

    if (typeof element.requestFullscreen !== 'function') return setIsOverlay(true)

    element.requestFullscreen().catch(() => setIsOverlay(true))
  }

  function exit() {
    if (isOverlay) return setIsOverlay(false)

    if (document.fullscreenElement) document.exitFullscreen()
  }

  const isOn = isNative || isOverlay

  return { isOn, isOverlay, exit, toggle: () => (isOn ? exit() : enter()) }
}

export type Fullscreen = ReturnType<typeof useFullscreen>
