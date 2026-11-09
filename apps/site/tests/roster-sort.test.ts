import { describe, expect, test } from 'bun:test'
import { legendAvatarUrl } from '../src/components/guild/legend-avatar-url'
import { defaultLegendSort, sortLegends, sortWeapons } from '../src/components/player/roster-sort'
import type { CareerLegend, RankedLegend, WeaponStats } from '../src/components/player/weapon-stats'

function legend(legendId: number, overrides: Partial<CareerLegend> = {}): CareerLegend {
  return {
    legendId,
    legendNameKey: 'bodvar',
    level: 10,
    xp: 100,
    games: 20,
    wins: 10,
    matchTime: 100,
    ...overrides,
  } as CareerLegend
}

function ranked(legendId: number, rating: number): RankedLegend {
  return { legendId, legendNameKey: 'bodvar', rating, peakRating: rating, tier: 'Gold 1', wins: 1, games: 2 }
}

function ids(legends: CareerLegend[]): number[] {
  return legends.map((item) => item.legendId)
}

function weapon(name: string, overrides: Partial<WeaponStats> = {}): WeaponStats {
  return { weapon: name, games: 1, wins: 0, timeHeld: 0, KOs: 0, damage: 0, ...overrides } as WeaponStats
}

const noRanked = new Map<number, RankedLegend>()

describe('sortLegends', () => {
  test('opens on elo', () => {
    expect(defaultLegendSort).toBe('elo')
  })

  test('level sorts by xp, so two level 100 legends still have an order', () => {
    const legends = [legend(1, { level: 100, xp: 2000 }), legend(2, { level: 100, xp: 3000 })]

    expect(ids(sortLegends(legends, noRanked, 'level'))).toEqual([2, 1])
  })

  test('elo uses each legend ranked rating, and unranked legends go last', () => {
    const legends = [legend(1), legend(2), legend(3)]

    const rankedById = new Map([
      [2, ranked(2, 1800)],
      [3, ranked(3, 1500)],
    ])

    expect(ids(sortLegends(legends, rankedById, 'elo'))).toEqual([2, 3, 1])
  })

  test('win rate ignores legends with too few games', () => {
    const legends = [legend(1, { games: 5, wins: 5 }), legend(2, { games: 20, wins: 10 })]

    expect(ids(sortLegends(legends, noRanked, 'winRate'))).toEqual([2, 1])
  })

  test('sorts by games and by playtime', () => {
    const legends = [legend(1, { games: 5, matchTime: 900 }), legend(2, { games: 20, matchTime: 100 })]

    expect(ids(sortLegends(legends, noRanked, 'games'))).toEqual([2, 1])
    expect(ids(sortLegends(legends, noRanked, 'playtime'))).toEqual([1, 2])
  })

  test('a legend newer than the game data keeps its row and shows the silhouette', () => {
    const legends = [legend(999_999, { legendNameKey: 'brand new legend' })]

    expect(ids(sortLegends(legends, noRanked, 'elo'))).toEqual([999_999])
    expect(legendAvatarUrl('brand new legend')).toBe('/images/legends/random.svg')
  })

  test('leaves the list it was given alone', () => {
    const legends = [legend(1, { xp: 1 }), legend(2, { xp: 2 })]

    sortLegends(legends, noRanked, 'level')

    expect(ids(legends)).toEqual([1, 2])
  })
})

describe('sortWeapons', () => {
  const weapons = [
    weapon('Axe', { timeHeld: 10, KOs: 9, damage: 1, games: 10, wins: 2 }),
    weapon('Bow', { timeHeld: 20, KOs: 1, damage: 5, games: 10, wins: 8 }),
  ]

  function names(sorted: WeaponStats[]): string[] {
    return sorted.map((item) => item.weapon)
  }

  test.each([
    ['playtime', ['Bow', 'Axe']],
    ['kos', ['Axe', 'Bow']],
    ['damage', ['Bow', 'Axe']],
    ['winRate', ['Bow', 'Axe']],
  ] as const)('%s', (sort, expected) => {
    expect(names(sortWeapons(weapons, sort))).toEqual([...expected])
  })

  test('win rate puts a weapon with no games last', () => {
    expect(names(sortWeapons([weapon('Unarmed', { games: 0 }), weapons[0] as WeaponStats], 'winRate'))).toEqual([
      'Axe',
      'Unarmed',
    ])
  })
})
