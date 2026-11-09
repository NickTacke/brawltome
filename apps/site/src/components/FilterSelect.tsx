import { ChevronDown } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export type FilterOption = { value: string; label: string; flag?: ReactNode; detail?: string }

type FilterSelectProps = {
  label: string
  value: string
  options: readonly FilterOption[]
  isLabelHidden?: boolean
  isIconOnly?: boolean
  onChange: (value: string) => void
}

const viewportMarginPx = 8
// matches grid-cols-5 on the icon panel
const iconGridColumns = 5

// when the panel can't fit, its start edge wins so the first options stay reachable
export function viewportShiftPx(startPx: number, endPx: number, viewportSizePx: number): number {
  const shiftToStartPx = viewportMarginPx - startPx

  if (shiftToStartPx > 0) return shiftToStartPx

  const overflowEndPx = endPx - (viewportSizePx - viewportMarginPx)

  if (overflowEndPx <= 0) return 0

  return Math.max(-overflowEndPx, shiftToStartPx)
}

function optionStep(key: string, columns: number): number | null {
  if (key === 'ArrowDown') return columns

  if (key === 'ArrowUp') return -columns

  if (columns === 1) return null

  if (key === 'ArrowRight') return 1

  if (key === 'ArrowLeft') return -1

  return null
}

export function nextOptionIndex(
  key: string,
  currentIndex: number,
  optionCount: number,
  columns: number,
): number | null {
  if (key === 'Home') return 0

  if (key === 'End') return optionCount - 1

  const step = optionStep(key, columns)

  if (step === null) return null

  return (currentIndex + step + optionCount) % optionCount
}

function useDismiss(
  isOpen: boolean,
  rootRef: RefObject<HTMLDivElement | null>,
  close: () => void,
  closeOnEscape: () => void,
) {
  useEffect(() => {
    if (!isOpen) return

    function closeIfOutside(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }

    // on the document, because safari doesn't focus a clicked button so the key never reaches the component
    function closeIfEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') closeOnEscape()
    }

    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('focusin', closeIfOutside)
    document.addEventListener('keydown', closeIfEscape)

    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('focusin', closeIfOutside)
      document.removeEventListener('keydown', closeIfEscape)
    }
  }, [isOpen, rootRef, close, closeOnEscape])
}

function useKeepPanelOnScreen(isOpen: boolean, panelRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    if (!isOpen) return

    function placePanel() {
      const panel = panelRef.current

      if (!panel) return

      panel.style.transform = ''
      const { left, right, top, bottom } = panel.getBoundingClientRect()
      const shiftXPx = viewportShiftPx(left, right, window.innerWidth)
      const shiftYPx = viewportShiftPx(top, bottom, window.innerHeight)

      panel.style.transform = `translate(${shiftXPx}px, ${shiftYPx}px)`
    }

    placePanel()
    window.addEventListener('resize', placePanel)

    return () => window.removeEventListener('resize', placePanel)
  }, [isOpen, panelRef])
}

function focusSelectedOption(panel: HTMLDivElement | null) {
  const selected = panel?.querySelector<HTMLButtonElement>('[aria-current="true"]')
  const firstOption = panel?.querySelector<HTMLButtonElement>('button')
  const target = selected ?? firstOption

  target?.focus()
}

function useOptionKeys(
  isOpen: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  columns: number,
  openFromKeyboard: () => void,
) {
  function openWithArrow(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    openFromKeyboard()
  }

  function moveOptionFocus(event: KeyboardEvent) {
    const buttons = Array.from(panelRef.current?.querySelectorAll('button') ?? [])
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = nextOptionIndex(event.key, currentIndex, buttons.length, columns)

    if (nextIndex === null) return

    event.preventDefault()

    if (currentIndex === -1) focusSelectedOption(panelRef.current)
    else buttons[nextIndex]?.focus()
  }

  return isOpen ? moveOptionFocus : openWithArrow
}

type OptionButtonProps = {
  option: FilterOption
  isSelected: boolean
  isIconOnly?: boolean
  onSelect: (event: MouseEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}

function OptionButton({ option, isSelected, isIconOnly, onSelect, onKeyDown }: OptionButtonProps) {
  const selectedStyle = isSelected ? 'bg-white/[0.08] text-strong' : 'text-text'

  if (isIconOnly) {
    return (
      <button
        type="button"
        title={option.label}
        aria-label={option.label}
        aria-current={isSelected ? 'true' : undefined}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`flex size-10 items-center justify-center rounded-sm transition-colors hover:bg-white/[0.08] ${selectedStyle}`}
      >
        {option.flag}
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium whitespace-nowrap transition-colors hover:bg-white/[0.06] ${selectedStyle}`}
    >
      {option.flag}
      <span className="flex-1">{option.label}</span>
      {option.detail && <span className="font-mono text-xs text-soft">{option.detail}</span>}
    </button>
  )
}

export function FilterSelect({ label, value, options, isLabelHidden, isIconOnly, onChange }: FilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldFocusOptionRef = useRef(false)
  const selected = options.find((option) => option.value === value)

  function close() {
    setIsOpen(false)
  }

  function closeAndRefocusTrigger() {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function openFromKeyboard() {
    shouldFocusOptionRef.current = true
    setIsOpen(true)
  }

  useDismiss(isOpen, rootRef, close, closeAndRefocusTrigger)
  useKeepPanelOnScreen(isOpen, panelRef)
  const handleKeyDown = useOptionKeys(isOpen, panelRef, isIconOnly ? iconGridColumns : 1, openFromKeyboard)

  useLayoutEffect(() => {
    if (isOpen && shouldFocusOptionRef.current) focusSelectedOption(panelRef.current)
  }, [isOpen])

  // detail is 0 for a click made with enter or space, only those move focus into the panel
  function toggle(event: MouseEvent) {
    shouldFocusOptionRef.current = event.detail === 0
    setIsOpen((current) => !current)
  }

  // a button focused from the keyboard keeps its ring through a press, unless the press itself gives it focus again
  function dropFocusBeforePress(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.blur()
  }

  function select(event: MouseEvent, next: string) {
    onChange(next)
    setIsOpen(false)

    if (event.detail === 0) triggerRef.current?.focus()
  }

  const panelLayout = isIconOnly ? 'grid w-max grid-cols-5 gap-0.5' : 'min-w-40'
  // the chevron's wide end makes it look off-centre even when it's exact, so it sits a pixel towards its point
  const chevronPosition = isOpen ? '-translate-y-px rotate-180' : 'translate-y-px'

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-2">
      {!isLabelHidden && <span className="hidden text-sm font-bold text-soft uppercase sm:inline">{label}:</span>}
      <button
        ref={triggerRef}
        type="button"
        title={isIconOnly ? selected?.label : undefined}
        aria-label={`${label}: ${selected?.label ?? value}`}
        aria-expanded={isOpen}
        onPointerDown={dropFocusBeforePress}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className="flex h-9 items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-soft transition-colors hover:text-strong aria-expanded:text-strong"
      >
        <span className="flex items-center gap-2">
          {selected?.flag}
          {!isIconOnly && selected?.label}
        </span>
        <ChevronDown className={`size-4 opacity-70 transition-transform ${chevronPosition}`} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          className={`absolute top-full right-0 z-50 mt-1 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-control border border-line bg-ink p-1 shadow-xl ${panelLayout}`}
        >
          {options.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              isSelected={option.value === value}
              isIconOnly={isIconOnly}
              onSelect={(event) => select(event, option.value)}
              onKeyDown={handleKeyDown}
            />
          ))}
        </div>
      )}
    </div>
  )
}
