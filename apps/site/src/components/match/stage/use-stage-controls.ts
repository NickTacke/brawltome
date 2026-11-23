import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

// how long the controls stay after the pointer last moved over the stage
const idleMs = 2500
// only a press on the picture plays or pauses, not one on the controls, which on a phone lie under it in the same frame
const picture = '[data-stage-window]'

type StageControlsOptions = {
  isPlaying: boolean
  onToggle: () => void
  isPhone: boolean
  isFullscreen: boolean
  // a review stands on a stop and its card explains it
  isAtStop: boolean
}

type ShownReasons = StageControlsOptions & { isAwake: boolean; isHeld: boolean; isPressed: boolean }

// on a page a pause keeps the controls up; a stage that fills the screen puts them away on a pause too, as only the
// picture is left to look at there, unless a review's card is explaining a stop
function isShownBy(reasons: ShownReasons): boolean {
  if (reasons.isPhone || reasons.isAwake || reasons.isHeld || reasons.isPressed) return true

  if (reasons.isFullscreen) return reasons.isAtStop

  return !reasons.isPlaying
}

/**
 * When the controls on the stage show, like a video player's: while the pointer moves over the stage, rests on them
 * or holds a press, as while scrubbing, and on a paused page. A press on the stage itself plays or pauses. On a phone
 * held upright the controls lie under the stage and always show, so the first tap on the picture already pauses.
 */
export function useStageControls(options: StageControlsOptions) {
  const { onToggle, isFullscreen } = options
  const [isAwake, setIsAwake] = useState(false)
  const [isHeld, setIsHeld] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const idleTimer = useRef<number | null>(null)
  // on a touch screen the first tap only brings the controls back
  const wasShownOnPress = useRef(true)
  const isShown = isShownBy({ ...options, isAwake, isHeld, isPressed })

  function stopTimer() {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
  }

  function wake() {
    stopTimer()
    setIsAwake(true)
    idleTimer.current = window.setTimeout(() => setIsAwake(false), idleMs)
  }

  function press(event: PointerEvent) {
    wasShownOnPress.current = isShown || event.pointerType === 'mouse'
    // only the main button scrubs; the browser's menu takes the release of the right one
    setIsPressed(event.button === 0)
    wake()
  }

  // the press ends on the scrubber too, which keeps hold of the pointer and hands its events up to the stage
  function release() {
    setIsPressed(false)
    wake()
  }

  // a finger lifting also leaves; only a mouse leaving puts the controls away at once. a press let go of outside the
  // stage ends there too
  function leave(event: PointerEvent) {
    setIsPressed(false)

    if (event.pointerType === 'mouse') setIsAwake(false)
  }

  function click(event: MouseEvent) {
    const isOnPicture = event.target instanceof Element && event.target.closest(picture) !== null

    if (isOnPicture && wasShownOnPress.current) onToggle()
  }

  // the stage filling the screen or leaving it moves the controls from under the pointer, and the overlay builds them
  // anew, so the pointer leaving them is never told
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of the screen is what lets go of them
  useEffect(() => {
    setIsHeld(false)
    setIsPressed(false)
  }, [isFullscreen])

  // the timer must not outlive the replay
  useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    },
    [],
  )

  return {
    isShown,
    // true while the pointer rests on the controls
    isHeld,
    wake,
    stage: {
      onPointerMove: wake,
      onPointerDown: press,
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: leave,
      onClick: click,
    },
    bar: { onPointerEnter: () => setIsHeld(true), onPointerLeave: () => setIsHeld(false) },
  }
}

export type StageControlsState = ReturnType<typeof useStageControls>
