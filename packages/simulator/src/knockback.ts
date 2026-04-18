import type { Power } from '@brawltome/game-data'
import type { EntityState } from './types'

// Knockback + hitstun application, derived from the decompiled game source.
// Magnitude formula from research/jpexs/out-10.05/scripts/§_-I5p§.as:622-770:
//   impulseBase = fixedImpulse[i] + variableImpulse[i]
//                 * (damage/100) * (1 + (damage/100)/2)
//   total       = max(minimumImpulse, impulseBase * strMult / weightDivisor)
// where damage is the defender's accumulated damage percent.
//
// Direction combines the position-delta between attacker and defender with
// the Power's impulseOffsetX/Y (facing-aware), optionally snapped to the
// nearest 45° if LockTo45Degrees. A slight downward bias (-0.25 * |dx|)
// prevents hits from launching purely sideways.
//
// Hitstun lasts `fixedStunTime` animation frames (at 60Hz). The defender's
// attack/dodge inputs are locked for that duration, but their velocity is
// free to evolve under gravity and any input drift. No damage-scaled stun.

const FRAME_MS = 1000 / 60
const DAMAGE_PCT_MAX = 700
// BH's impulse values are in engine-native units. Applied as-is to our
// sim's per-second velocities, they're about as strong as walking, which
// feels right: a 0%-damage hit slides the defender a short distance, a
// high-damage hit launches them across the screen. Tuning against the
// SmallTerminus stats dump showed that any scale >>1 over-launches
// defenders out of engagement range and starves follow-up hit detection.
const IMPULSE_SCALE = 1

export function strengthMultiplier(strength: number): number {
  return 0.5 + strength * 0.1
}

// Approximation for the defender's weight-based knockback divisor. The
// real field `§_-Q5D§.§_-Dc§` is opaque; using `1 + (weight-5)*0.1` keeps
// the "heavies take less knockback" semantics with 1.0x at the default
// weight of 5 and 1.5x at 10.
function weightDivisor(weight: number): number {
  return Math.max(0.5, 1 + (weight - 5) * 0.1)
}

// Quantise a direction vector to the nearest 45° cardinal, preserving
// magnitude. Mirrors the LockTo45Degrees post-process in §_-h3M§.as.
function snap45(dx: number, dy: number): { x: number; y: number } {
  const mag = Math.hypot(dx, dy) || 1
  const ang = Math.atan2(dy, dx)
  const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
  return { x: Math.cos(snap) * mag, y: Math.sin(snap) * mag }
}

export type KnockbackInput = {
  power: Power
  hitboxIdx: number
  attacker: EntityState
  defender: EntityState
  attackerStrength: number
  defenderWeight: number
}

export type KnockbackResult = {
  vx: number
  vy: number
  hitstunMs: number
}

// Computes the knockback velocity and hitstun duration to apply to the
// defender. Caller is responsible for writing vx/vy onto defender.vel and
// setting defender.hitstunUntilMs. damagePct should be updated separately.
export function computeKnockback(input: KnockbackInput): KnockbackResult {
  const { power, hitboxIdx, attacker, defender, attackerStrength, defenderWeight } = input
  const fixed = power.fixedImpulse[hitboxIdx] ?? power.fixedImpulse[0] ?? 0
  const variable = power.variableImpulse[hitboxIdx] ?? power.variableImpulse[0] ?? 0
  const min = power.minimumImpulse[hitboxIdx] ?? power.minimumImpulse[0] ?? 0

  const dmgFrac = Math.min(DAMAGE_PCT_MAX, Math.max(0, defender.damagePct)) / 100
  const scaledVar = variable * dmgFrac * (1 + dmgFrac / 2)
  const strMult = power.ignoreStrength ? 1 : strengthMultiplier(attackerStrength)
  const raw = (fixed + scaledVar) * strMult
  const totalImp = Math.max(min, raw / weightDivisor(defenderWeight))

  // Direction: position delta + facing-aware offset + downward bias.
  let dx = defender.pos.x - attacker.pos.x
  let dy = defender.pos.y - attacker.pos.y - 0.25 * Math.abs(dx)
  const offX = (power.impulseOffsetX[hitboxIdx] ?? power.impulseOffsetX[0] ?? 0) * attacker.facing
  const offY = power.impulseOffsetY[hitboxIdx] ?? power.impulseOffsetY[0] ?? 0
  dx += offX
  dy += offY

  if (power.lockTo45Degrees) {
    const s = snap45(dx, dy)
    dx = s.x
    dy = s.y
  }

  const mag = Math.hypot(dx, dy)
  const nx = mag > 0 ? dx / mag : attacker.facing
  const ny = mag > 0 ? dy / mag : 0

  const hitstunMs = power.fixedStunTime * FRAME_MS
  return { vx: nx * totalImp * IMPULSE_SCALE, vy: ny * totalImp * IMPULSE_SCALE, hitstunMs }
}
