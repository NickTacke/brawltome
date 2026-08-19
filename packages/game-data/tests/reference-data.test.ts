import { describe, expect, test } from 'bun:test'
import {
  type LegendReference,
  aggregateWeapons,
  createLegendReferenceIndex,
  legendSlug,
  normalizeWeaponName,
} from '../index'

const references: LegendReference[] = [
  {
    legendId: 3,
    legendNameKey: 'bodvar',
    bioName: 'Bödvar',
    weaponOne: 'Fists',
    weaponTwo: 'Pistol',
  },
  {
    legendId: 4,
    legendNameKey: 'cassidy',
    bioName: 'Cassidy',
    weaponOne: 'Hammer',
    weaponTwo: 'Pistol',
  },
]

describe('legend references', () => {
  test('creates independent indexes by id and key', () => {
    const first = createLegendReferenceIndex(references)
    const second = createLegendReferenceIndex([references[1]])

    expect(first.getById(3)).toBe(references[0])
    expect(first.getByKey('cassidy')).toBe(references[1])
    expect(second.getById(3)).toBeUndefined()
    expect(second.getByKey('missing')).toBeUndefined()
  })

  test('normalizes legend and weapon identifiers', () => {
    expect(legendSlug(3, 'BÖDVAR')).toBe('bodvar')
    expect(legendSlug(42, 'Lord Vraxx')).toBe('lord vraxx')
    expect(legendSlug(17, 'RED RAPTOR')).toBe('redraptor')
    expect(legendSlug(72, 'QINGHUA & BAOBAO')).toBe('qinghua')
    expect(normalizeWeaponName('Fists')).toBe('Gauntlets')
    expect(normalizeWeaponName('Pistol')).toBe('Blasters')
    expect(normalizeWeaponName('Hammer')).toBe('Hammer')
  })

  test('aggregates resolved legend weapons by descending held time', () => {
    const index = createLegendReferenceIndex(references)
    const aggregates = aggregateWeapons(
      [
        {
          legendId: 3,
          damageWeaponOne: 100n,
          damageWeaponTwo: 50n,
          timeHeldWeaponOne: 20,
          timeHeldWeaponTwo: 10,
          koWeaponOne: 2,
          koWeaponTwo: 1,
        },
        {
          legendId: 4,
          damageWeaponOne: 25n,
          damageWeaponTwo: 75n,
          timeHeldWeaponOne: 5,
          timeHeldWeaponTwo: 30,
          koWeaponOne: 1,
          koWeaponTwo: 3,
        },
        {
          legendId: 999,
          damageWeaponOne: 500n,
          damageWeaponTwo: 500n,
          timeHeldWeaponOne: 500,
          timeHeldWeaponTwo: 500,
          koWeaponOne: 5,
          koWeaponTwo: 5,
        },
      ],
      index,
    )

    expect(aggregates).toEqual([
      { weapon: 'Blasters', timeHeld: 40, damage: 125n, kos: 4 },
      { weapon: 'Gauntlets', timeHeld: 20, damage: 100n, kos: 2 },
      { weapon: 'Hammer', timeHeld: 5, damage: 25n, kos: 1 },
    ])
  })
})
