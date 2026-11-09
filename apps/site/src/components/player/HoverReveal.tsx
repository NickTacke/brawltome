import { type ReactNode, useEffect, useRef, useState } from 'react'

type HoverRevealProps = {
  label: string
  triggerClassName?: string
  trigger: ReactNode
  children: ReactNode
}

// touch screens have no hover, so a tap opens the panel and a second tap or a tap elsewhere closes it
export function HoverReveal({ label, triggerClassName = '', trigger, children }: HoverRevealProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function closeIfOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeIfOutside)

    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [isOpen])

  const openStyle = isOpen ? 'visible opacity-100' : 'invisible opacity-0'

  return (
    <span
      ref={rootRef}
      data-reveal-trigger
      onKeyDown={(event) => event.key === 'Escape' && setIsOpen(false)}
      className="group/reveal relative inline-flex"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={label}
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex min-h-6 cursor-default items-center gap-1.5 ${triggerClassName}`}
      >
        {trigger}
      </button>
      {/* padding instead of a margin, so the pointer can reach the panel without leaving it */}
      <div
        data-reveal
        className={`absolute top-full left-0 z-50 pt-1 transition-opacity duration-100 group-hover/reveal:visible group-hover/reveal:opacity-100 group-has-[:focus-visible]/reveal:visible group-has-[:focus-visible]/reveal:opacity-100 ${openStyle}`}
      >
        <div className="rounded-control border border-line bg-ink p-1 shadow-xl">{children}</div>
      </div>
    </span>
  )
}
