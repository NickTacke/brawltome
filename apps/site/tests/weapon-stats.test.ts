import { describe, expect, test } from 'bun:test'
import { legends as allLegends, getLegendById, normalizeWeaponName } from '@brawltome/game-data'
import { type CareerLegend, knownWeapons, type RankedLegend, weaponStats } from '../src/components/player/weapon-stats'

// the first record is a placeholder with no weapons
const playableLegends = allLegends.filter((legend) => legend.weaponOne !== '')
const bodvar = playableLegends[0]

function legendWith(overrides: Partial<CareerLegend> = {}): CareerLegend {
  return {
    legendId: bodvar?.heroId ?? 1,
    legendNameKey: 'bodvar',
    games: 10,
    wins: 6,
    matchTime: 1000,
    kos: 5,
    falls: 2,
    weaponOne: { heldTime: 300, damage: '100', kos: 3 },
    weaponTwo: { heldTime: 200, damage: '50', kos: 1 },
    unarmed: { damage: '10', kos: 1 },
    ...overrides,
  } as CareerLegend
}

function rankedWith(overrides: Partial<RankedLegend> = {}): RankedLegend {
  return {
    legendId: bodvar?.heroId ?? 1,
    legendNameKey: 'bodvar',
    rating: 1500,
    peakRating: 1600,
    tier: 'Gold 1',
    wins: 2,
    games: 4,
    ...overrides,
  }
}

const firstWeapon = normalizeWeaponName(bodvar?.weaponOne ?? '')
const secondWeapon = normalizeWeaponName(bodvar?.weaponTwo ?? '')

function statsFor(name: string, legends: CareerLegend[], ranked: RankedLegend[] = []) {
  return weaponStats(legends, ranked).find((stats) => stats.weapon === name)
}

describe('weaponStats', () => {
  test('adds both weapon slots of a legend', () => {
    expect(statsFor(firstWeapon, [legendWith()])).toMatchObject({
      timeHeld: 300,
      KOs: 3,
      damage: 100,
      games: 10,
      wins: 6,
    })
    expect(statsFor(secondWeapon, [legendWith()])).toMatchObject({ timeHeld: 200, KOs: 1, damage: 50 })
  })

  test('shares add up to the whole time held', () => {
    const shares = weaponStats([legendWith()], []).map((stats) => stats.share)

    expect(shares).toEqual([0.6, 0.4])
  })

  test('a legend the game data does not know yet is skipped without throwing', () => {
    expect(weaponStats([legendWith({ legendId: 999_999 })], [])).toEqual([])
  })

  test('every weapon a legend can hold has an icon', () => {
    const names = playableLegends.flatMap((legend) => [legend.weaponOne, legend.weaponTwo]).map(normalizeWeaponName)

    expect(names.filter((name) => !knownWeapons.has(name))).toEqual([])
  })

  test('leaves out weapons a player never used', () => {
    const unused = { heldTime: 0, damage: '0', kos: 0 }

    expect(weaponStats([legendWith({ weaponOne: unused, weaponTwo: unused })], [])).toEqual([])
  })

  test('an unplayed ranked legend adds nothing to the averages', () => {
    const stats = statsFor(firstWeapon, [legendWith()], [rankedWith({ games: 0, rating: 750, peakRating: 0 })])

    expect(stats?.ranked.ratings).toEqual([])
  })

  test('tracks the best ranked legend', () => {
    const stats = statsFor(firstWeapon, [legendWith()], [rankedWith()])

    expect(stats?.ranked.highestElo).toEqual({ key: 'bodvar', elo: 1500 })
    expect(stats?.ranked.highestPeak).toEqual({ key: 'bodvar', elo: 1600 })
    expect(stats?.ranked.mostPlayed).toEqual({ key: 'bodvar', games: 4 })
  })
})

test('game data still knows the legend used here', () => {
  expect(getLegendById(bodvar?.heroId ?? 0)).toBeDefined()
})
