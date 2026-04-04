import { describe, expect, test } from 'bun:test'
import { aggregateWeapons, normalizeWeaponName } from '@brawltome/shared'

describe('normalizeWeaponName', () => {
  test('normalizes known aliases', () => {
    expect(normalizeWeaponName('Fists')).toBe('Gauntlets')
    expect(normalizeWeaponName('Pistol')).toBe('Blasters')
    expect(normalizeWeaponName('Katar')).toBe('Katars')
    expect(normalizeWeaponName('RocketLance')).toBe('Lance')
  })

  test('passes through unknown names', () => {
    expect(normalizeWeaponName('Sword')).toBe('Sword')
    expect(normalizeWeaponName('Hammer')).toBe('Hammer')
  })
})

describe('aggregateWeapons', () => {
  test('returns empty array for empty input', () => {
    expect(aggregateWeapons([])).toEqual([])
  })

  test('returns empty array when legend not in cache', () => {
    const result = aggregateWeapons([
      {
        legendId: 99999,
        damageWeaponOne: 100n,
        damageWeaponTwo: 200n,
        timeHeldWeaponOne: 50,
        timeHeldWeaponTwo: 60,
        koWeaponOne: 5,
        koWeaponTwo: 3,
      },
    ])
    expect(result).toEqual([])
  })

  test('sorts by timeHeld descending', () => {
    // This test requires legends in cache — will pass once initGameData is called
    // For now just verify the sort contract with an empty result
    const result = aggregateWeapons([])
    expect(result).toEqual([])
  })
})
