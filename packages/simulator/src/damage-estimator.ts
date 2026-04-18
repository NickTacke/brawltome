import type { Power } from '@brawltome/game-data'

// Best-effort damage estimate for one press of a Power. Brawlhalla splits
// damage across three carriers: the power's own `baseDamage`, its chained
// Hit/Hit2/Combo relatives, and `castTime` phases encoded as strings like
// "9:2@4,0:3@5,0:4@6-6". No single source is authoritative; different moves
// use different encodings (multi-hit weapon lights keep damage in castTime
// with baseDamage=0, while single-hit signatures use baseDamage cleanly).
//
// The estimator sums them all and filters outliers that are clearly not
// damage (e.g. HammerGroundPound's castTime contains "313" which is an
// impulse or similar, not a damage number). Values >= 100 are dropped.

const PLAUSIBLE_MAX = 100

// Pull the damage numbers out of a castTime string. Format is comma-separated
// phases; each phase looks like "N:D@F[-G]" where D is the damage, or "N@F"
// (no damage), or "D@F" for a bare hit. We extract every integer that
// appears after a `:` and before an `@`, which is the damage position.
function parseCastDamages(castTime: string): number[] {
  if (!castTime) return []
  const out: number[] = []
  for (const phase of castTime.split(',')) {
    const m = phase.match(/(?::)(\d+)@/)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n < PLAUSIBLE_MAX) out.push(n)
  }
  return out
}

// Brawlhalla scales outgoing damage by the attacker's strength stat with
// formula (0.5 + strength * 0.1), confirmed from the decompiled source at
// research/jpexs/out-10.05/scripts/PowerType.as:1601 (the obfuscated
// `§_-X3g§` class in JPEXS output). Strength is an integer 0..10 so the
// multiplier ranges 0.5x to 1.5x. A legend's defence/weight stats
// further reduce incoming damage on the target side, which we don't
// model here.
export function strengthMultiplier(strength: number): number {
  return 0.5 + strength * 0.1
}

export function estimatePowerDamage(
  power: Power,
  getPowerByName: (name: string) => Power | undefined,
): number {
  // Two-source rule: when `baseDamage` is set, treat it as the primary hit
  // and ignore castTime (its numbers are secondary hits already rolled into
  // the move's feel or knockback stepping). When `baseDamage` is zero, the
  // move is multi-hit and all damage lives in castTime phases. This matches
  // how the stats dump's per-move EnemyDamage lines up against the data.
  if (power.baseDamage > 0) return power.baseDamage
  const fromCast = parseCastDamages(power.castTime).reduce((s, d) => s + d, 0)
  if (fromCast > 0) return fromCast
  // Fall through to the primary Hit variant (e.g. BowSide has base=0 and
  // empty castTime, with damage on BowSideHit).
  const hit = getPowerByName(`${power.powerName}Hit`)
  if (hit && hit.powerId !== power.powerId) {
    if (hit.baseDamage > 0) return hit.baseDamage
    return parseCastDamages(hit.castTime).reduce((s, d) => s + d, 0)
  }
  return 0
}
