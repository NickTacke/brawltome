import { type RefObject, useEffect, useRef } from 'react'

// how much of the replay has to be in view before the page's keys belong to it
const visibleShare = 0.4
const fields = 'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="combobox"]'

// space and enter on a button or link press it, and a field takes every key
function isBusyElsewhere(event: KeyboardEvent): boolean {
  if (!(event.target instanceof Element)) return false

  const isPressingButton = event.target.closest('button, a') !== null && (event.key === ' ' || event.key === 'Enter')

  return isPressingButton || event.target.closest(fields) !== null
}

/** Gives the replay the keyboard while it is on screen, without it needing focus. The handler says whether it used the key. */
export function useReplayKeys(frameRef: RefObject<HTMLElement | null>, onKey: (event: KeyboardEvent) => boolean) {
  const handlerRef = useRef(onKey)

  handlerRef.current = onKey

  useEffect(() => {
    const frame = frameRef.current

    if (!frame) return

    let isOnScreen = false

    const observer = new IntersectionObserver(
      ([entry]) => {
        isOnScreen = entry?.isIntersecting ?? false
      },
      { threshold: visibleShare },
    )

    function handleKey(event: KeyboardEvent) {
      if (!isOnScreen || isBusyElsewhere(event)) return

      if (handlerRef.current(event)) event.preventDefault()
    }

    observer.observe(frame)
    window.addEventListener('keydown', handleKey)

    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', handleKey)
    }
  }, [frameRef])
}
