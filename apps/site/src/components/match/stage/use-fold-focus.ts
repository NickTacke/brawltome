import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Folding the lanes takes their own controls away, as the stops on them. Keyboard focus on one of those would fall
 * to the page, so it goes to the button that folds the lanes instead.
 */
export function useFoldFocus(
  groupRef: RefObject<HTMLElement | null>,
  foldButtonRef: RefObject<HTMLElement | null>,
  isFolded: boolean,
) {
  const lastFocused = useRef<Element | null>(null)

  useEffect(() => {
    const group = groupRef.current

    if (!group) return

    const remember = (event: FocusEvent) => {
      lastFocused.current = event.target instanceof Element ? event.target : null
    }

    group.addEventListener('focusin', remember)

    return () => group.removeEventListener('focusin', remember)
  }, [groupRef])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a fold takes controls away under the focus
  useLayoutEffect(() => {
    const focused = lastFocused.current
    // focus that moved on somewhere else on the page stays there
    const isFocusOnPage = document.activeElement === null || document.activeElement === document.body
    const isFocusLost = focused !== null && !focused.isConnected && isFocusOnPage

    if (!isFocusLost) return

    lastFocused.current = null
    foldButtonRef.current?.focus()
  }, [isFolded])
}
