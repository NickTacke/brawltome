import { describe, expect, test } from 'bun:test'
import {
  createLegendReferenceIndex,
  type LegendReference,
  legendAvatarUrl,
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
    expect(legendSlug(72, 'QINGHUA & BAOBAO')).toBe('qinghua & baobao')
    expect(normalizeWeaponName('Fists')).toBe('Gauntlets')
    expect(normalizeWeaponName('Pistol')).toBe('Blasters')
    expect(normalizeWeaponName('Hammer')).toBe('Hammer')
  })

  test('encodes avatar URLs so multi-word and ampersand keys resolve', () => {
    expect(legendAvatarUrl('bodvar')).toBe('/images/legends/avatars/bodvar.png')
    expect(legendAvatarUrl('king zuva')).toBe('/images/legends/avatars/king%20zuva.png')
    expect(legendAvatarUrl('qinghua & baobao')).toBe('/images/legends/avatars/qinghua%20%26%20baobao.png')
  })
})
