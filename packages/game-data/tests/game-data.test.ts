import { describe, expect, test } from 'bun:test'
import {
  GAME_DATA_PATCH_VERSION,
  getHurtboxByName,
  getLegendById,
  getLegendByName,
  getLevelById,
  getLevelGeometry,
  getPowerById,
  hurtboxes,
  knownHeroIds,
  knownLevelIds,
  legends,
  levelGeometry,
  levels,
  powers,
} from '../index'

describe('legends', () => {
  test('has at least the expected core legends', () => {
    expect(legends.length).toBeGreaterThanOrEqual(60)
    const bodvar = getLegendByName('Viking')
    expect(bodvar?.heroId).toBe(3)
    expect(bodvar?.displayName).toBe('BÖDVAR')
    expect(bodvar?.weaponOne).toBe('Hammer')
    expect(bodvar?.weaponTwo).toBe('Sword')
  })

  test('getLegendById returns the same object as getLegendByName', () => {
    const sample = legends.find((l) => l.isActive)
    if (!sample) throw new Error('no active legend in fixture')
    expect(getLegendById(sample.heroId)).toEqual(sample)
    expect(getLegendByName(sample.heroName)).toEqual(sample)
  })

  test('unknown id returns undefined', () => {
    expect(getLegendById(99999)).toBeUndefined()
  })
})

describe('levels', () => {
  test('has MishimaDojo (id 223) and SuzakuCastle (id 185)', () => {
    expect(getLevelById(223)?.levelName).toBeTruthy()
    expect(getLevelById(185)?.levelName).toBeTruthy()
    expect(levels.length).toBeGreaterThanOrEqual(50)
  })
})

describe('powers', () => {
  test('has 3000+ moves', () => {
    expect(powers.length).toBeGreaterThan(3000)
  })

  test('samples have plausible damage + impulse', () => {
    const withDamage = powers.filter((p) => p.baseDamage > 0)
    expect(withDamage.length).toBeGreaterThan(500)
    const withImpulse = powers.filter((p) => p.variableImpulse > 0 || p.fixedImpulse > 0)
    expect(withImpulse.length).toBeGreaterThan(500)
  })

  test('lookup by id', () => {
    const sample = powers.find((p) => p.baseDamage > 0)
    if (!sample) throw new Error('no damaging power in fixture')
    expect(getPowerById(sample.powerId)).toEqual(sample)
  })
})

describe('hurtboxes', () => {
  test('non-empty, lookup by name', () => {
    expect(hurtboxes.length).toBeGreaterThan(100)
    const sample = hurtboxes.find((h) => h.width > 0 && h.height > 0)
    if (!sample) throw new Error('no hurtbox with dimensions in fixture')
    expect(getHurtboxByName(sample.hurtboxName)).toEqual(sample)
  })
})

describe('validation ID sets', () => {
  test('knownHeroIds covers all generated legends', () => {
    for (const l of legends) expect(knownHeroIds.has(l.heroId)).toBe(true)
    expect(knownHeroIds.size).toBe(legends.length)
  })

  test('knownLevelIds covers all generated levels', () => {
    for (const l of levels) expect(knownLevelIds.has(l.levelId)).toBe(true)
    expect(knownLevelIds.size).toBe(levels.length)
  })
})

describe('metadata', () => {
  test('patch version is set', () => {
    expect(GAME_DATA_PATCH_VERSION).toMatch(/^\d+\.\d+$|^unknown$/)
  })
})

describe('level geometry', () => {
  test('loaded at least 100 levels', () => {
    expect(Object.keys(levelGeometry).length).toBeGreaterThan(100)
  })

  test('a sample level has camera bounds, kill bounds, and collisions', () => {
    const sample = Object.values(levelGeometry).find((g) => g.cameraBounds && g.collisions.length > 3)
    if (!sample) throw new Error('no geometry sample with collisions')
    expect(sample.levelName).toBeTruthy()
    expect(sample.cameraBounds?.w).toBeGreaterThan(0)
    expect(sample.cameraBounds?.h).toBeGreaterThan(0)
    expect(sample.collisions.some((c) => c.kind === 'hard')).toBe(true)
  })

  test('getLevelGeometry returns undefined for unknown level name', () => {
    expect(getLevelGeometry('NotARealLevel')).toBeUndefined()
  })

  test('collision lines have finite coordinates', () => {
    let count = 0
    for (const g of Object.values(levelGeometry)) {
      for (const c of g.collisions) {
        expect(Number.isFinite(c.x1)).toBe(true)
        expect(Number.isFinite(c.x2)).toBe(true)
        expect(Number.isFinite(c.y1)).toBe(true)
        expect(Number.isFinite(c.y2)).toBe(true)
        count++
      }
    }
    expect(count).toBeGreaterThan(1000)
  })
})
