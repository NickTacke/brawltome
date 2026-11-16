import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

// how long the controls stay after the pointer last moved over the stage
const idleMs = 2500
// only a press on the picture plays or pauses, not one on the controls, which on a phone lie under it in the same frame
const picture = '[data-stage-window]'

/**
 * When the controls on the stage show, like a video player's: always while paused, and while playing for as long as
 * the pointer moves over the stage or rests on them. A press on the stage itself plays or pauses. On a phone held
 * upright the controls lie under the stage and always show, so the first tap on the picture already pauses.
 */
export function useStageControls(isPlaying: boolean, onToggle: () => void, isPhone: boolean) {
  const [isAwake, setIsAwake] = useState(false)
  const [isHeld, setIsHeld] = useState(false)
  const idleTimer = useRef<number | null>(null)
  // on a touch screen the first tap only brings the controls back
  const wasShownOnPress = useRef(true)
  const isShown = isPhone || !isPlaying || isAwake || isHeld

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
    wake()
  }

  // a finger lifting also leaves; only a mouse leaving puts the controls away at once
  function leave(event: PointerEvent) {
    if (event.pointerType === 'mouse') setIsAwake(false)
  }

  function click(event: MouseEvent) {
    const isOnPicture = event.target instanceof Element && event.target.closest(picture) !== null

    if (isOnPicture && wasShownOnPress.current) onToggle()
  }

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
    stage: { onPointerMove: wake, onPointerDown: press, onPointerLeave: leave, onClick: click },
    bar: { onPointerEnter: () => setIsHeld(true), onPointerLeave: () => setIsHeld(false) },
  }
}

export type StageControlsState = ReturnType<typeof useStageControls>
