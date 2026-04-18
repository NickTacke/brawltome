import type { Power } from '@brawltome/game-data'

// Per-press damage estimate derived from Brawlhalla's own source data.
// The primary signal is Power.baseDamage, which is an array indexed by
// hitbox slot. Most presses connect only one hitbox (the strongest one)
// to the target; we take the max as the representative damage.
//
// When the starter's array is empty or all zeros (common for powers that
// have a dedicated `*Hit` follow-through), we try the Hit variant's array.
// Still zero means the move isn't a damaging primary (dodges, pickups, ...)
// and the estimator returns 0.
//
// This approach was validated against the SmallTerminus stats dump where
// per-hit damages fall within ~5% of real values for most moves after
// applying the strength/weight multipliers from the game source.

// Attacker's strength scales outgoing damage. Formula from the decompiled
// source at research/jpexs/out-10.05/scripts/§_-X3g§.as:1601 :
//   damage * (0.5 + strength * 0.1)
// giving 0.5x..1.5x across the 0..10 strength range.
export function strengthMultiplier(strength: number): number {
  return 0.5 + strength * 0.1
}

// Defender's weight reduces incoming damage. Formula from the same source,
// line 1605 (misidentified as dexterity in an earlier research pass, the
// index actually reads `§_-Q2O§` which is weight):
//   damage * (1.5 - weight * 0.1)
// giving 0.5x..1.5x inversely with weight, i.e. heavies take less damage.
export function weightMultiplier(weight: number): number {
  return 1.5 - weight * 0.1
}

function maxOrZero(arr: readonly number[]): number {
  if (arr.length === 0) return 0
  let m = 0
  for (const n of arr) if (n > m) m = n
  return m
}

// Fallback variant names to try when the starter's baseDamage array is
// empty or all zeros. Viking weapon signatures are the main case: the
// starter (e.g. HammerSmashSideViking) is a pure trigger record with
// zero damage, and the real numbers live on *Release* or *Hit* variants
// the engine chains to after the charge window.
const DAMAGE_FALLBACK_SUFFIXES = ['Release', 'Hit', 'Hit2', 'Hit3', 'Combo']

export function estimatePowerDamage(power: Power, getPowerByName: (name: string) => Power | undefined): number {
  const starter = maxOrZero(power.baseDamage)
  if (starter > 0) return starter
  for (const suffix of DAMAGE_FALLBACK_SUFFIXES) {
    const variant = getPowerByName(`${power.powerName}${suffix}`)
    if (!variant || variant.powerId === power.powerId) continue
    const dmg = maxOrZero(variant.baseDamage)
    if (dmg > 0) return dmg
  }
  return 0
}

// Returns the Power record whose baseDamage the estimator chose for the
// given starter power. Hit detection + knockback also need this so the
// knockback formula reads from the variant that actually carries the
// impulse/stun data, not the zero-filled trigger record.
export function resolveDamageVariant(power: Power, getPowerByName: (name: string) => Power | undefined): Power {
  if (maxOrZero(power.baseDamage) > 0) return power
  for (const suffix of DAMAGE_FALLBACK_SUFFIXES) {
    const variant = getPowerByName(`${power.powerName}${suffix}`)
    if (!variant || variant.powerId === power.powerId) continue
    if (maxOrZero(variant.baseDamage) > 0) return variant
  }
  return power
}
