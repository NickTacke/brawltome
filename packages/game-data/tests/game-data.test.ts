import { describe, expect, test } from 'bun:test'
import {
  crossoverSkinIdsByLegend,
  getCrossoverSkinById,
  getHurtboxByName,
  getLegendById,
  getLegendByName,
  getLevelById,
  getPowerById,
  getSkinById,
  hurtboxes,
  knownHeroIds,
  knownLevelIds,
  legends,
  levels,
  powers,
  resolvePlayerAppearance,
  skins,
} from '../index'

describe('legends', () => {
  test('has at least the expected core legends', () => {
    expect(legends.length).toBeGreaterThanOrEqual(60)
    const bodvar = getLegendByName('Viking')
    expect(bodvar?.heroId).toBe(3)
    expect(bodvar?.displayName).toBe('BÖDVAR')
    expect(bodvar?.weaponOne).toBe('Hammer')
    expect(bodvar?.weaponTwo).toBe('Sword')

    expect(getLegendById(17)?.displayName).toBe('RED RAPTOR')
    expect(getLegendById(71)).toMatchObject({
      heroName: 'ActualGladiator',
      displayName: 'AURUS',
      weaponOne: 'Chakram',
      weaponTwo: 'Spear',
    })
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

describe('skin appearances', () => {
  test('looks up generated skins and groups crossover IDs by owning legend', () => {
    const crossover = skins.find((skin) => skin.isCrossover)
    if (!crossover) throw new Error('generated catalog has no crossover skin')

    expect(getSkinById(crossover.skinId)).toBe(crossover)
    expect(getCrossoverSkinById(crossover.skinId)).toBe(crossover)
    expect(crossoverSkinIdsByLegend.get(crossover.legendId)).toContain(crossover.skinId)
  })

  test('resolves an exact crossover with a base legend image fallback', () => {
    const crossover = skins.find((skin) => skin.isCrossover)
    if (!crossover) throw new Error('generated catalog has no crossover skin')
    const appearance = resolvePlayerAppearance(crossover.legendId, crossover.skinId)

    expect(appearance).toMatchObject({
      kind: 'crossover',
      legendId: crossover.legendId,
      skinId: crossover.skinId,
      name: crossover.displayName,
      imageUrl: crossover.imageUrl,
      diagnostic: null,
    })
    expect(appearance.fallbackImageUrl).toMatch(/^\/images\/legends\/avatars\/.+\.png$/)
  })

  test('uses the base legend for known non-crossovers and unknown skin IDs', () => {
    expect(resolvePlayerAppearance(3, 3)).toMatchObject({
      kind: 'legend',
      legendId: 3,
      name: 'BÖDVAR',
      diagnostic: null,
    })
    expect(resolvePlayerAppearance(3, 2_147_483_647)).toMatchObject({
      kind: 'legend',
      legendId: 3,
      name: 'BÖDVAR',
      diagnostic: { code: 'unknown_skin', legendId: 3, skinId: 2_147_483_647 },
    })
  })

  test('uses neutral output for an unknown legend and diagnoses owner mismatches', () => {
    expect(resolvePlayerAppearance(2_147_483_647, 2_147_483_647)).toEqual({
      kind: 'legend',
      legendId: 2_147_483_647,
      skinId: 2_147_483_647,
      name: 'Legend 2147483647',
      imageUrl: null,
      fallbackImageUrl: null,
      diagnostic: { code: 'unknown_legend', legendId: 2_147_483_647, skinId: 2_147_483_647 },
    })

    const crossover = skins.find((skin) => skin.isCrossover && skin.legendId !== 3)
    if (!crossover) throw new Error('fixture needs a crossover not owned by Bödvar')
    expect(resolvePlayerAppearance(3, crossover.skinId).diagnostic).toEqual({
      code: 'skin_legend_mismatch',
      legendId: 3,
      skinId: crossover.skinId,
    })
  })
})
