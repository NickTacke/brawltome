import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { nextOptionIndex, panelVerticalShiftPx, viewportShiftPx } from './filter-select-logic'
import { readRootFontSizePx } from './root-font-size'

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

function useKeepPanelOnScreen(
  isOpen: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
) {
  useLayoutEffect(() => {
    if (!isOpen) return

    function placePanel() {
      const panel = panelRef.current

      if (!panel) return

      panel.style.transform = ''
      const { left, right, top, bottom } = panel.getBoundingClientRect()
      const triggerTopPx = triggerRef.current?.getBoundingClientRect().top ?? top
      const rootFontSizePx = readRootFontSizePx()
      const shiftXPx = viewportShiftPx(left, right, window.innerWidth, rootFontSizePx)

      const shiftYPx = panelVerticalShiftPx({
        panelTopPx: top,
        panelBottomPx: bottom,
        triggerTopPx,
        viewportHeightPx: window.innerHeight,
        rootFontSizePx,
      })

      panel.style.transform = `translate(${shiftXPx}px, ${shiftYPx}px)`
    }

    placePanel()
    window.addEventListener('resize', placePanel)

    return () => window.removeEventListener('resize', placePanel)
  }, [isOpen, panelRef, triggerRef])
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

    // after a mouse open focus is still on the trigger, so arrows start from the selected option
    const startsFromSelected = currentIndex === -1 && event.key !== 'Home' && event.key !== 'End'

    if (startsFromSelected) focusSelectedOption(panelRef.current)
    else buttons[nextIndex]?.focus()
  }

  return isOpen ? moveOptionFocus : openWithArrow
}

export function useFilterSelect(columns: number, onChange: (value: string) => void) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldFocusOptionRef = useRef(false)

  function closeAndRefocusTrigger() {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function openFromKeyboard() {
    shouldFocusOptionRef.current = true
    setIsOpen(true)
  }

  useDismiss(isOpen, rootRef, () => setIsOpen(false), closeAndRefocusTrigger)
  useKeepPanelOnScreen(isOpen, panelRef, triggerRef)
  const handleKeyDown = useOptionKeys(isOpen, panelRef, columns, openFromKeyboard)

  useLayoutEffect(() => {
    if (isOpen && shouldFocusOptionRef.current) focusSelectedOption(panelRef.current)
  }, [isOpen])

  // detail is 0 for a click made with enter or space, only those move focus into the panel
  function toggle(event: MouseEvent) {
    shouldFocusOptionRef.current = event.detail === 0
    setIsOpen((current) => !current)
  }

  function select(event: MouseEvent, next: string) {
    onChange(next)
    setIsOpen(false)

    if (event.detail === 0) triggerRef.current?.focus()
  }

  return { isOpen, rootRef, panelRef, triggerRef, toggle, handleKeyDown, select }
}
