import { InputFlag } from '@brawltome/replay-format'
import type { AttackAttempt, AttackButton, AttackDirection, Posture } from './types'

// Bit positions for each attack button. Order matters: if multiple buttons
// are pressed on the same tick we emit one event per button in this order.
const BUTTONS: { flag: number; button: AttackButton }[] = [
  { flag: InputFlag.Light, button: 'light' },
  { flag: InputFlag.Heavy, button: 'heavy' },
  { flag: InputFlag.DodgeDash, button: 'dodge' },
  { flag: InputFlag.PickUpThrow, button: 'throw' },
]

// Translates held directional flags into a single enum value. Vertical wins:
// Up + any horizontal reads as 'up' (matches the engine's sig precedence for
// air-up / up-signature selection).
export function directionFromFlags(flags: number): AttackDirection {
  if ((flags & InputFlag.AimUp) !== 0) return 'up'
  if ((flags & InputFlag.Drop) !== 0) return 'down'
  const left = (flags & InputFlag.MoveLeft) !== 0
  const right = (flags & InputFlag.MoveRight) !== 0
  if (left !== right) return 'side'
  return 'neutral'
}

// Edge-detect attack presses by comparing this tick's flags to the previous
// tick's. Returns one AttackAttempt per button freshly pressed. Input posture
// is the entity's state at the start of the tick (before the tick's physics
// have run), which is what the in-engine state machine would see.
export function detectAttackAttempts(args: {
  tick: number
  ms: number
  entityId: number
  flags: number
  prevFlags: number
  posture: Posture
}): AttackAttempt[] {
  const { tick, ms, entityId, flags, prevFlags, posture } = args
  const direction = directionFromFlags(flags)
  const out: AttackAttempt[] = []
  for (const { flag, button } of BUTTONS) {
    const nowOn = (flags & flag) !== 0
    const prevOn = (prevFlags & flag) !== 0
    if (nowOn && !prevOn) {
      out.push({ tick, ms, entityId, button, direction, posture })
    }
  }
  return out
}
