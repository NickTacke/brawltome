import { describe, expect, test } from 'bun:test'
import {
  getHurtboxByName,
  getLegendById,
  getLegendByName,
  getLevelById,
  getPhysicsByHeroId,
  getPowerById,
  getRune,
  getRunesForHero,
  hurtboxes,
  knownHeroIds,
  knownLevelIds,
  legends,
  levels,
  physics,
  powers,
  resolveLegendPhysics,
  runes,
  statLadders,
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

describe('stat ladders', () => {
  test('has all four player stat ladders at 0-11 plus Template', () => {
    const names = new Set(statLadders.map((s) => s.statName))
    for (const prefix of ['Speed', 'Strength', 'Weight', 'Dexterity']) {
      for (let i = 0; i <= 11; i++) expect(names.has(`${prefix}${i}`)).toBe(true)
    }
    expect(names.has('Template')).toBe(true)
  })

  test('Template baseline values match the game', () => {
    const tpl = statLadders.find((s) => s.statName === 'Template')
    expect(tpl?.values.RunSpeed).toBe(30)
    expect(tpl?.values.Recovery).toBe(4)
    expect(tpl?.values.JumpXImpulse).toBe(30)
  })

  test('ladder rungs increase monotonically', () => {
    const speeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
      (i) => statLadders.find((s) => s.statName === `Speed${i}`)?.values.RunSpeed ?? 0
    )
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1])
  })
})

describe('legend physics', () => {
  test('covers every active legend with a signature', () => {
    const active = legends.filter((l) => l.isActive && l.heroId > 0)
    for (const l of active) expect(getPhysicsByHeroId(l.heroId)).toBeDefined()
  })

  test('resolveLegendPhysics returns the same record as getPhysicsByHeroId', () => {
    const sample = legends.find((l) => l.isActive && l.heroId > 0)
    if (!sample) throw new Error('no active legend')
    expect(resolveLegendPhysics(sample)).toEqual(getPhysicsByHeroId(sample.heroId))
  })

  test('Hattori (S4 D6 W4 Sp8) has known physics numbers', () => {
    const hattori = legends.find((l) => l.heroName === 'Ninja')
    if (!hattori) throw new Error('no Hattori')
    const p = getPhysicsByHeroId(hattori.heroId)
    expect(p?.stats).toEqual({ strength: 4, dexterity: 6, weight: 4, speed: 8 })
    expect(p?.physics.impulseMult).toBe(1.028)
    expect(p?.physics.recovery).toBe(8.1667)
    expect(p?.physics.runSpeed).toBe(49.81)
  })

  test('every resolved physics record is complete', () => {
    for (const p of physics) {
      expect(p.heroId).toBeGreaterThan(0)
      for (const v of Object.values(p.physics)) expect(v).toBeGreaterThan(0)
    }
  })
})

describe('runes (stances)', () => {
  test('every hero has exactly 10 runes', () => {
    const perHero = new Map<string, number>()
    for (const r of runes) perHero.set(r.heroName, (perHero.get(r.heroName) ?? 0) + 1)
    for (const [hero, n] of perHero) expect(n, hero).toBe(10)
  })

  test('rune 0 (Base) matches the legend stat signature', () => {
    for (const l of legends) {
      if (l.heroId <= 0 || !l.isActive) continue
      const base = getRune(l.heroName, 0)
      if (!base) continue // stub legends (Random etc.) have no rune data
      expect(base.strength).toBe(l.strength)
      expect(base.dexterity).toBe(l.dexterity)
      expect(base.weight).toBe(l.weight)
      expect(base.speed).toBe(l.speed)
    }
  })

  test('Ulgrim (Dwarf) SuperSpeed is S5 D3 W6 Sp8 (verified live by LO)', () => {
    const ss = getRune('Dwarf', 6)
    expect(ss?.iconName).toBe('a_StanceIcon_SuperSpeed')
    expect(ss?.strength).toBe(5)
    expect(ss?.dexterity).toBe(3)
    expect(ss?.weight).toBe(6)
    expect(ss?.speed).toBe(8)
  })

  test('getRunesForHero returns all 10 for a known hero', () => {
    expect(getRunesForHero('Viking').length).toBe(10)
    expect(getRunesForHero('NonexistentHero').length).toBe(0)
  })
})
