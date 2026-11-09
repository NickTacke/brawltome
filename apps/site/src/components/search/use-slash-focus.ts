import { type RefObject, useEffect } from 'react'

function isTypingIn(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true

  return target instanceof HTMLElement && target.isContentEditable
}

/** Moves the cursor to the field on `/`, unless the visitor is already typing somewhere. */
export function useSlashFocus(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function focusOnSlash(event: KeyboardEvent) {
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey

      if (event.key !== '/' || hasModifier || isTypingIn(event.target)) return

      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', focusOnSlash)

    return () => window.removeEventListener('keydown', focusOnSlash)
  }, [inputRef])
}
