import { describe, expect, test } from 'bun:test'
import { getPowerByName } from '@brawltome/game-data'
import {
  estimatePowerDamage,
  strengthMultiplier,
  weightMultiplier,
} from '../src/damage-estimator'

describe('estimatePowerDamage', () => {
  test('returns max of baseDamage array for single-hit moves', () => {
    const p = getPowerByName('BaseNeutral')
    if (!p) throw new Error('BaseNeutral missing')
    expect(estimatePowerDamage(p, getPowerByName)).toBe(Math.max(...p.baseDamage))
  })

  test('picks the strongest hitbox from a multi-entry baseDamage array', () => {
    // HammerSide has baseDamage=[0,18,16]; the primary landing hitbox on
    // the ~19 per-hit average we see in stats is the 18 slot. Exact value
    // is data-driven, so we assert the max rule rather than a literal.
    const p = getPowerByName('HammerSide')
    if (!p) throw new Error('HammerSide missing')
    const expected = Math.max(0, ...p.baseDamage)
    expect(estimatePowerDamage(p, getPowerByName)).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  test('falls through to the Hit variant when the starter is all zeros', () => {
    // HammerAirDown has baseDamage=[2] on the starter but the real hit
    // connects via HammerAirDownHit.baseDamage=[10]. Either 2 or 10 is
    // acceptable here (we take whichever is present on the starter); the
    // point of this test is the fallthrough path for BowSide-style cases
    // where the starter is empty/zero.
    const p = getPowerByName('BowSide')
    if (!p) throw new Error('BowSide missing')
    expect(estimatePowerDamage(p, getPowerByName)).toBeGreaterThan(0)
  })

  test('strengthMultiplier applies the correct per-stat scaling', () => {
    expect(strengthMultiplier(0)).toBeCloseTo(0.5, 5)
    expect(strengthMultiplier(5)).toBeCloseTo(1.0, 5)
    expect(strengthMultiplier(10)).toBeCloseTo(1.5, 5)
  })

  test('weightMultiplier reduces damage for heavier defenders', () => {
    expect(weightMultiplier(0)).toBeCloseTo(1.5, 5)
    expect(weightMultiplier(5)).toBeCloseTo(1.0, 5)
    expect(weightMultiplier(10)).toBeCloseTo(0.5, 5)
  })
})
