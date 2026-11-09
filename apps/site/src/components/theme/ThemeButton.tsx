import { useEffect, useRef, useState } from 'react'
import { ThemePicker } from './ThemePicker'

function useCloseOnOutsidePress(isOpen: boolean, close: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function closeIfOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, close])

  return rootRef
}

/** The footer's theme picker, so visitors who aren't signed in can choose a theme too. */
export function ThemeButton({ className }: { className: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useCloseOnOutsidePress(isOpen, () => setIsOpen(false))

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} className={className}>
        Theme
      </button>
      {isOpen && (
        <div className="fixed inset-x-3 bottom-3 z-50 max-h-[85dvh] overflow-y-auto rounded-control border border-line bg-ink p-4 shadow-xl md:absolute md:inset-x-auto md:right-0 md:bottom-full md:mb-3 md:max-h-none md:w-[340px] md:overflow-visible">
          <h2 className="text-base font-bold text-strong">Theme</h2>
          <ThemePicker />
        </div>
      )}
    </div>
  )
}
