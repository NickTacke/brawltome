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
    expect(getLegendById(72)).toMatchObject({
      heroName: 'AstroGirl',
      displayName: 'QINGHUA & BAOBAO',
      weaponOne: 'Orb',
      weaponTwo: 'Cannon',
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
  test('looks up generated skins and completely groups sorted crossover IDs by owner', () => {
    const crossover = skins.find((skin) => skin.isCrossover)
    const nonCrossover = skins.find((skin) => !skin.isCrossover)
    if (!crossover || !nonCrossover) throw new Error('generated catalog needs crossover and base skins')

    expect(getSkinById(crossover.skinId)).toBe(crossover)
    expect(getSkinById(2_147_483_647)).toBeUndefined()
    expect(getCrossoverSkinById(crossover.skinId)).toBe(crossover)
    expect(getCrossoverSkinById(nonCrossover.skinId)).toBeUndefined()
    expect(getCrossoverSkinById(2_147_483_647)).toBeUndefined()

    const expectedOwners = new Set(skins.filter((skin) => skin.isCrossover).map((skin) => skin.legendId))
    expect(new Set(crossoverSkinIdsByLegend.keys())).toEqual(expectedOwners)
    for (const [legendId, ids] of crossoverSkinIdsByLegend) {
      expect(ids).toEqual([...ids].sort((left, right) => left - right))
      expect(ids).toEqual(
        skins.filter((skin) => skin.isCrossover && skin.legendId === legendId).map((skin) => skin.skinId),
      )
    }
  })

  test('resolves an exact crossover with a base legend image fallback', () => {
    const crossover = skins.find((skin) => skin.isCrossover)
    if (!crossover) throw new Error('generated catalog has no crossover skin')
    const appearance = resolvePlayerAppearance(crossover.legendId, crossover.skinId)

    expect(appearance).toEqual({
      kind: 'crossover',
      legendId: 11,
      skinId: 351,
      name: 'King Knight',
      imageUrl: 'https://cms.brawlhalla.com/c/uploads/2021/07/a_Roster_Pose_KingKnightM.png',
      fallbackImageUrl: '/images/legends/avatars/sir roland.png',
      diagnostic: null,
    })
  })

  test('uses the base legend for known non-crossovers and unknown skin IDs', () => {
    expect(resolvePlayerAppearance(3, 3)).toEqual({
      kind: 'legend',
      legendId: 3,
      skinId: 3,
      name: 'BÖDVAR',
      imageUrl: '/images/legends/avatars/bodvar.png',
      fallbackImageUrl: '/images/legends/avatars/bodvar.png',
      diagnostic: null,
    })
    expect(resolvePlayerAppearance(3, 2_147_483_647)).toEqual({
      kind: 'legend',
      legendId: 3,
      skinId: 2_147_483_647,
      name: 'BÖDVAR',
      imageUrl: '/images/legends/avatars/bodvar.png',
      fallbackImageUrl: '/images/legends/avatars/bodvar.png',
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
    expect(resolvePlayerAppearance(3, crossover.skinId)).toEqual({
      kind: 'legend',
      legendId: 3,
      skinId: crossover.skinId,
      name: 'BÖDVAR',
      imageUrl: '/images/legends/avatars/bodvar.png',
      fallbackImageUrl: '/images/legends/avatars/bodvar.png',
      diagnostic: {
        code: 'skin_legend_mismatch',
        legendId: 3,
        skinId: crossover.skinId,
      },
    })
  })
})
