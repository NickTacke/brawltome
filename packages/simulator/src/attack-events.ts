import { InputFlag } from '@brawltome/replay-format'
import { resolveAttackPower } from './attack-resolver'
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
// tick's. Returns one AttackAttempt per button freshly pressed, each tagged
// with the Power the resolver mapped it to (or nulls when the combination
// doesn't correspond to a damaging move, e.g. dodges). Input posture is the
// entity's state at the start of the tick, which is what the in-engine state
// machine would see.
export function detectAttackAttempts(args: {
  tick: number
  ms: number
  entityId: number
  flags: number
  prevFlags: number
  posture: Posture
  weapon: string
  legend?: string
}): AttackAttempt[] {
  const { tick, ms, entityId, flags, prevFlags, posture, weapon, legend } = args
  const direction = directionFromFlags(flags)
  const out: AttackAttempt[] = []
  for (const { flag, button } of BUTTONS) {
    const nowOn = (flags & flag) !== 0
    const prevOn = (prevFlags & flag) !== 0
    if (!nowOn || prevOn) continue
    const power = resolveAttackPower({ weapon, button, direction, posture, legend })
    out.push({
      tick,
      ms,
      entityId,
      button,
      direction,
      posture,
      powerId: power?.powerId ?? null,
      powerName: power?.powerName ?? null,
    })
  }
  return out
}
