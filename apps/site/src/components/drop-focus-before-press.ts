import type { PointerEvent } from 'react'

// a button focused from the keyboard keeps its ring through a press, unless the press itself gives it focus again
export function dropFocusBeforePress(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.blur()
}
