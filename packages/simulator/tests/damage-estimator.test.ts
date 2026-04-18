import { describe, expect, test } from 'bun:test'
import { getPowerByName } from '@brawltome/game-data'
import { estimatePowerDamage } from '../src/damage-estimator'

describe('estimatePowerDamage', () => {
  test('returns baseDamage when set (single-hit moves)', () => {
    const p = getPowerByName('BaseNeutral')
    if (!p) throw new Error('BaseNeutral missing')
    // BaseNeutral.baseDamage=3; castTime is ignored when baseDamage is set.
    expect(estimatePowerDamage(p, getPowerByName)).toBe(p.baseDamage)
  })

  test('recovers damage from castTime for moves with baseDamage=0', () => {
    const p = getPowerByName('HammerSide')
    if (!p) throw new Error('HammerSide missing')
    // HammerSide has baseDamage=0 but castTime "9:2@4,0:3@5,0:4@6-6" carries
    // 2+3+4=9 damage. Family sum should recover this.
    expect(estimatePowerDamage(p, getPowerByName)).toBeGreaterThanOrEqual(9)
  })

  test('filters obvious non-damage outliers in castTime', () => {
    // HammerGroundPound has castTime containing "313", clearly an impulse
    // not a damage number. The estimator should discard it.
    const p = getPowerByName('HammerGroundPound')
    if (!p) throw new Error('HammerGroundPound missing')
    expect(estimatePowerDamage(p, getPowerByName)).toBeLessThan(100)
  })

  test('falls through to the primary Hit variant when starter is empty', () => {
    // BowSide has baseDamage=0 with an empty castTime. Its damage lives
    // on BowSideHit, which the estimator consults as a last resort.
    const p = getPowerByName('BowSide')
    if (!p) throw new Error('BowSide missing')
    expect(estimatePowerDamage(p, getPowerByName)).toBeGreaterThan(0)
  })
})
