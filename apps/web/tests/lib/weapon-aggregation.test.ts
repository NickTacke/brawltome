import { describe, expect, test } from 'bun:test'
import { aggregateRichWeaponStats } from '../../src/lib/weapon-aggregation'

const legend = (legendId: number, legendNameKey: string, games: number) => ({
  legendId,
  legendNameKey,
  bioName: legendNameKey,
  weaponOne: 'Sword',
  weaponTwo: null,
  timeHeldWeaponOne: 1,
  timeHeldWeaponTwo: 0,
  koWeaponOne: 0,
  koWeaponTwo: 0,
  damageWeaponOne: '0',
  damageWeaponTwo: '0',
  games,
  wins: 0,
  xp: 0,
  level: 0,
})

describe('aggregateRichWeaponStats', () => {
  test('derives ranked most-played from ranked games instead of career games', () => {
    const [sword] = aggregateRichWeaponStats(
      [legend(1, 'career-favorite', 1_000), legend(2, 'ranked-favorite', 100)],
      [
        {
          legendId: 1,
          legendNameKey: 'career-favorite',
          rating: 1_500,
          peakRating: 1_600,
          tier: 'Gold',
          wins: 1,
          games: 2,
        },
        {
          legendId: 2,
          legendNameKey: 'ranked-favorite',
          rating: 1_600,
          peakRating: 1_700,
          tier: 'Gold',
          wins: 20,
          games: 30,
        },
      ],
    )

    expect(sword.ranked.mostPlayed).toEqual({ name: 'ranked-favorite', key: 'ranked-favorite', games: 30 })
  })
})
