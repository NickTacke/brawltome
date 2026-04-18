import { getPowerByName, type Power } from '@brawltome/game-data'
import type { AttackButton, AttackDirection, Posture } from './types'

// Input to the resolver. `weapon` is the in-hand weapon name matching the
// power-naming prefix (e.g. 'Base' for unarmed, 'Sword', 'Hammer', ...).
// V1 of damage-sim always passes 'Base' because we don't track weapon
// pickups during a match yet. `legend` is only consulted for weapon
// signatures, which are legend-specific (e.g. SwordSmashNeutralViking).
export type ResolveInput = {
  weapon: string
  button: AttackButton
  direction: AttackDirection
  posture: Posture
  legend?: string
}

// Name-suffix table mapping (button, direction, airborne) to the part of
// the power name that follows the weapon prefix. Entries returning null
// mean the input combination has no damaging move (e.g. unarmed air-side
// heavy doesn't exist; dodges never produce a Power).
//
// Conventions, cross-referenced with BaseNeutral/BaseAir/BaseSmash* etc.:
//   ground light: ''          | 'Side'        | 'Down'        (no up-light)
//   ground heavy: 'SmashUp'    | 'SmashSide'   | 'SmashDown'   ('Up' maps to SmashUp)
//   air light:    'Air'        | 'AirSide'     | 'AirDown'     (up-air folds into 'Air')
//   air heavy:    'AirUpHeavy' | null          | 'GroundPound' (no air-side heavy)
function suffixFor(
  button: AttackButton,
  direction: AttackDirection,
  airborne: boolean,
): string | null {
  if (button === 'dodge') return null
  if (button === 'throw') return 'Thrown'
  if (airborne) {
    if (button === 'light') {
      if (direction === 'side') return 'AirSide'
      if (direction === 'down') return 'AirDown'
      return 'Air'
    }
    // heavy in the air
    if (direction === 'down') return 'GroundPound'
    if (direction === 'side') return null
    return 'AirUpHeavy'
  }
  // grounded
  if (button === 'light') {
    if (direction === 'side') return 'Side'
    if (direction === 'down') return 'Down'
    return 'Neutral'
  }
  // heavy on ground
  if (direction === 'side') return 'SmashSide'
  if (direction === 'down') return 'SmashDown'
  return 'SmashUp'
}

// For weapon signatures, Brawlhalla appends the legend's internal hero name
// to the smash power (e.g. SwordSmashSideKnight). Base signatures don't get
// this suffix. This helper returns the candidate names in priority order so
// the caller can try each against the power table.
function candidateNames(weapon: string, suffix: string, legend?: string): string[] {
  const base = `${weapon}${suffix}`
  if (!legend) return [base]
  if (suffix.startsWith('Smash') && weapon !== 'Base') return [`${base}${legend}`, base]
  return [base]
}

// Resolves an input combination to the Power record that fires, or null if
// the combination has no damaging move (dodges, unsupported combos, etc.).
// The caller is expected to have already edge-detected the press.
export function resolveAttackPower(input: ResolveInput): Power | null {
  const airborne = input.posture !== 'ground'
  const suffix = suffixFor(input.button, input.direction, airborne)
  if (suffix === null) return null
  for (const name of candidateNames(input.weapon, suffix, input.legend)) {
    const p = getPowerByName(name)
    if (p) return p
  }
  return null
}
