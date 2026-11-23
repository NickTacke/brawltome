import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react'
import type { OverlayPosition } from './app-status'
import { menuAction, type Spot, spotGroups, spotIndex, spotLabel, spots } from './overlay-spots'

type PositionPickerProps = {
  position: OverlayPosition
  onChange: (position: OverlayPosition) => void
  // for the tests, which render to markup and can't click
  isInitiallyOpen?: boolean
}

// a button naming the spot, and the nine spots in a list that opens above it, as the settings sit at the
// window's foot
export function PositionPicker({ position, onChange, isInitiallyOpen = false }: PositionPickerProps) {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen)
  const [activeIndex, setActiveIndex] = useState(() => spotIndex(position))
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const listId = useId()
  const label = spotLabel(position)

  useEffect(() => {
    if (!isOpen) return

    return closeOnPointerOutside(rootRef, () => setIsOpen(false))
  }, [isOpen])

  // the active spot holds the focus, so the keys reach it and a screen reader reads it
  useEffect(() => {
    if (isOpen) optionRefs.current[activeIndex]?.focus()
  }, [isOpen, activeIndex])

  const open = () => {
    setActiveIndex(spotIndex(position))
    setIsOpen(true)
  }

  // focus goes back to the button, so the keyboard picks up where it was
  const close = () => {
    setIsOpen(false)
    buttonRef.current?.focus()
  }

  const choose = (chosen: OverlayPosition) => {
    onChange(chosen)
    close()
  }

  const onOptionKeyDown = (event: KeyboardEvent) => {
    const action = menuAction(event.key, activeIndex)

    if (action.kind === 'none') return

    // tab still moves on to the next control
    if (event.key !== 'Tab') event.preventDefault()

    if (action.kind === 'move') setActiveIndex(action.activeIndex)

    if (action.kind === 'choose') choose(action.position)

    if (action.kind === 'close') close()
  }

  return (
    <div className="spot-picker" ref={rootRef}>
      <button
        type="button"
        className="spot-button"
        ref={buttonRef}
        aria-label={`Overlay spot: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={isOpen ? close : open}
      >
        {label}
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      {isOpen && (
        <div className="spot-menu" id={listId} role="listbox" aria-label="Overlay spot">
          {spots.map((spot, index) => (
            <div
              className="spot-option"
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              role="option"
              tabIndex={-1}
              aria-selected={spot.position === position}
              data-active={index === activeIndex}
              data-starts-row={startsRow(spot)}
              key={spot.position}
              onClick={() => choose(spot.position)}
              onKeyDown={onOptionKeyDown}
              onPointerMove={() => setActiveIndex(index)}
            >
              {spot.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// a rule above the middle and bottom rows of the screen
function startsRow(spot: Spot): boolean {
  return spotGroups.slice(1).some((group) => group[0] === spot)
}

function closeOnPointerOutside(rootRef: RefObject<HTMLElement | null>, close: () => void): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (rootRef.current?.contains(event.target as Node)) return

    close()
  }

  document.addEventListener('pointerdown', onPointerDown)

  return () => document.removeEventListener('pointerdown', onPointerDown)
}
