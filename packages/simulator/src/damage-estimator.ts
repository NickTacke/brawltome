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

export function estimatePowerDamage(power: Power, getPowerByName: (name: string) => Power | undefined): number {
  const starter = maxOrZero(power.baseDamage)
  if (starter > 0) return starter
  const hit = getPowerByName(`${power.powerName}Hit`)
  if (hit && hit.powerId !== power.powerId) return maxOrZero(hit.baseDamage)
  return 0
}
