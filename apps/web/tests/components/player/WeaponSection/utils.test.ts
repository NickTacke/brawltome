import { describe, expect, it } from 'bun:test'
import { computeWeaponDerived, sortWeapons } from '../../../../src/components/player/WeaponSection/utils'
import type { RichWeaponAgg } from '../../../../src/lib/weapon-aggregation'

const W = (overrides: Partial<RichWeaponAgg> = {}): RichWeaponAgg =>
  ({
    weapon: 'Sword',
    games: 0,
    wins: 0,
    timeHeld: 0,
    damage: 0,
    KOs: 0,
    share: 0,
    usageRate: 0,
    legendCount: 0,
    totalLevel: 0,
    xp: 0,
    ranked: {
      games: 0,
      wins: 0,
      ratings: [],
      peakRatings: [],
      mostPlayed: { key: null, games: 0 },
      highestElo: { key: null, elo: 0 },
      highestPeak: { key: null, elo: 0 },
    },
    ...overrides,
  }) as RichWeaponAgg

describe('sortWeapons', () => {
  it('sorts by timePlayed desc', () => {
    const result = sortWeapons(
      [W({ weapon: 'A', timeHeld: 100 }), W({ weapon: 'B', timeHeld: 300 }), W({ weapon: 'C', timeHeld: 200 })],
      'timePlayed',
    )
    expect(result.map((w) => w.weapon)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by games desc', () => {
    const result = sortWeapons(
      [W({ weapon: 'A', games: 10 }), W({ weapon: 'B', games: 30 }), W({ weapon: 'C', games: 20 })],
      'games',
    )
    expect(result.map((w) => w.weapon)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by winrate desc, treating zero-game weapons as 0% winrate', () => {
    const result = sortWeapons(
      [
        W({ weapon: 'A', games: 10, wins: 5 }),
        W({ weapon: 'B', games: 100, wins: 80 }),
        W({ weapon: 'C', games: 0, wins: 0 }),
      ],
      'winrate',
    )
    expect(result.map((w) => w.weapon)).toEqual(['B', 'A', 'C'])
  })

  it('sorts by damage desc', () => {
    const result = sortWeapons(
      [W({ weapon: 'A', damage: 100 }), W({ weapon: 'B', damage: 300 }), W({ weapon: 'C', damage: 200 })],
      'damage',
    )
    expect(result.map((w) => w.weapon)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by kos desc', () => {
    const result = sortWeapons(
      [W({ weapon: 'A', KOs: 10 }), W({ weapon: 'B', KOs: 30 }), W({ weapon: 'C', KOs: 20 })],
      'kos',
    )
    expect(result.map((w) => w.weapon)).toEqual(['B', 'C', 'A'])
  })

  it('does not mutate the input array', () => {
    const input = [W({ weapon: 'A', timeHeld: 100 }), W({ weapon: 'B', timeHeld: 300 })]
    sortWeapons(input, 'timePlayed')
    expect(input.map((w) => w.weapon)).toEqual(['A', 'B'])
  })
})

describe('computeWeaponDerived', () => {
  it('computes all fields for a typical weapon', () => {
    const result = computeWeaponDerived(
      W({
        games: 100,
        wins: 60,
        timeHeld: 36000,
        damage: 50000,
        KOs: 200,
        legendCount: 5,
        totalLevel: 50,
        xp: 250000,
        ranked: {
          games: 50,
          wins: 30,
          ratings: [1500, 1600, 1700],
          peakRatings: [1700, 1800, 1900],
          mostPlayed: { key: null, games: 0 },
          highestElo: { key: null, elo: 0 },
          highestPeak: { key: null, elo: 0 },
        },
      }),
    )
    expect(result.winrate).toBeCloseTo(60, 2)
    expect(result.dps).toBeCloseTo(50000 / 36000, 5)
    expect(result.avgKos).toBeCloseTo(2, 2)
    expect(result.avgElo).toBeCloseTo(1600, 2)
    expect(result.avgPeak).toBeCloseTo(1800, 2)
    expect(result.rankedWinrate).toBeCloseTo(60, 2)
    expect(result.dmgPerKO).toBe(250)
    expect(result.avgDmgPerGame).toBe(500)
    expect(result.avgLegendLevel).toBe(10)
    expect(result.avgLegendXp).toBe(50000)
  })

  it('returns 0 winrate when games is 0', () => {
    expect(computeWeaponDerived(W({ games: 0, wins: 0 })).winrate).toBe(0)
  })

  it('returns 0 dps when timeHeld is 0', () => {
    expect(computeWeaponDerived(W({ timeHeld: 0, damage: 100 })).dps).toBe(0)
  })

  it('returns 0 avgKos when games is 0', () => {
    expect(computeWeaponDerived(W({ games: 0, KOs: 50 })).avgKos).toBe(0)
  })

  it('returns 0 avgElo when ratings is empty', () => {
    expect(computeWeaponDerived(W()).avgElo).toBe(0)
  })

  it('returns 0 avgPeak when peakRatings is empty', () => {
    expect(computeWeaponDerived(W()).avgPeak).toBe(0)
  })

  it('returns 0 rankedWinrate when ranked.games is 0', () => {
    expect(computeWeaponDerived(W()).rankedWinrate).toBe(0)
  })

  it('returns 0 dmgPerKO when KOs is 0', () => {
    expect(computeWeaponDerived(W({ damage: 1000, KOs: 0 })).dmgPerKO).toBe(0)
  })

  it('returns 0 avgDmgPerGame when games is 0', () => {
    expect(computeWeaponDerived(W({ damage: 1000, games: 0 })).avgDmgPerGame).toBe(0)
  })

  it('returns 0 avgLegendLevel when legendCount is 0', () => {
    expect(computeWeaponDerived(W({ totalLevel: 50, legendCount: 0 })).avgLegendLevel).toBe(0)
  })

  it('returns 0 avgLegendXp when legendCount is 0', () => {
    expect(computeWeaponDerived(W({ xp: 1000, legendCount: 0 })).avgLegendXp).toBe(0)
  })
})
