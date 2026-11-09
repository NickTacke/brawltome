import { describe, expect, test } from 'bun:test'
import { unarmedStats } from '../src/components/player/unarmed-stats'
import type { CareerLegend } from '../src/components/player/weapon-stats'

function legend(matchTime: number, heldOne: number, heldTwo: number, unarmedKos = 2, games = 1): CareerLegend {
  return {
    matchTime,
    games,
    weaponOne: { heldTime: heldOne, damage: '0', kos: 0 },
    weaponTwo: { heldTime: heldTwo, damage: '0', kos: 0 },
    unarmed: { damage: '30', kos: unarmedKos },
  } as CareerLegend
}

describe('unarmedStats', () => {
  test('time is match time minus time holding a weapon', () => {
    expect(unarmedStats([legend(1000, 300, 200)]).timeHeld).toBe(500)
  })

  test('time is never negative', () => {
    expect(unarmedStats([legend(100, 300, 200)]).timeHeld).toBe(0)
  })

  test('adds kos and damage across legends', () => {
    expect(unarmedStats([legend(10, 0, 0), legend(10, 0, 0, 3)])).toMatchObject({ KOs: 5, damage: 60 })
  })

  test('counts only legends that were played', () => {
    expect(unarmedStats([legend(10, 0, 0), legend(0, 0, 0, 0, 0)]).legendCount).toBe(1)
  })
})
