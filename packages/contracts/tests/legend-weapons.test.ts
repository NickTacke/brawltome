import { describe, expect, test } from 'bun:test'
import { getLegendById, normalizeWeaponName } from '@brawltome/game-data'
import { legendWeapons } from '../src/legend-weapons'

describe('legendWeapons', () => {
  test('leaves out the placeholder record with no weapons', () => {
    expect(legendWeapons.has(1)).toBe(false)
  })

  test('gives a legend its weapons under the names the site shows', () => {
    const [legendId, weapons] = [...legendWeapons.entries()][0] as [number, { weaponOne: string; weaponTwo: string }]
    const reference = getLegendById(legendId)

    expect(weapons).toEqual({
      weaponOne: normalizeWeaponName(reference?.weaponOne ?? ''),
      weaponTwo: normalizeWeaponName(reference?.weaponTwo ?? ''),
    })
  })

  test('uses one spelling for fists', () => {
    const names = [...legendWeapons.values()].flatMap(({ weaponOne, weaponTwo }) => [weaponOne, weaponTwo])

    expect(names).toContain('Gauntlets')
    expect(names).not.toContain('Fists')
  })
})
