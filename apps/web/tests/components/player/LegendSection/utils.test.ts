import { describe, expect, it } from 'bun:test'
import {
  type RankedLegend,
  computeLegendStats,
  computeWeaponStats,
  sortLegends,
} from '../../../../src/components/player/LegendSection/utils'

describe('computeWeaponStats', () => {
  it('returns null timeToKill when kos is 0', () => {
    expect(computeWeaponStats({ time: 100, dmg: 50, kos: 0 })).toEqual({
      dps: 0.5,
      timeToKill: null,
    })
  })

  it('computes timeToKill when kos is positive', () => {
    expect(computeWeaponStats({ time: 100, dmg: 50, kos: 5 })).toEqual({
      dps: 0.5,
      timeToKill: 20,
    })
  })

  it('returns 0 dps when time is 0', () => {
    expect(computeWeaponStats({ time: 0, dmg: 50, kos: 5 })).toEqual({
      dps: 0,
      timeToKill: null,
    })
  })

  it('returns 0 dps and null timeToKill when both time and kos are 0', () => {
    expect(computeWeaponStats({ time: 0, dmg: 0, kos: 0 })).toEqual({
      dps: 0,
      timeToKill: null,
    })
  })
})

describe('computeLegendStats', () => {
  it('computes winrate and playtime correctly', () => {
    const stats = computeLegendStats({
      legendId: 1,
      games: 100,
      wins: 60,
      matchTime: 7200,
      xp: 0,
      level: 1,
      elo: 0,
      peakElo: 0,
    })
    expect(stats.winrate).toBeCloseTo(0.6, 5)
    expect(stats.playtimeHours).toBeCloseTo(2, 5)
  })

  it('returns zero winrate when games is 0', () => {
    const stats = computeLegendStats({
      legendId: 1,
      games: 0,
      wins: 0,
      matchTime: 0,
      xp: 0,
      level: 1,
      elo: 0,
      peakElo: 0,
    })
    expect(stats.winrate).toBe(0)
  })
})

describe('sortLegends', () => {
  const L = (id: number, partial: Partial<RankedLegend> = {}): RankedLegend => ({
    legendId: id,
    xp: 0,
    games: 0,
    wins: 0,
    matchTime: 0,
    level: 1,
    elo: 0,
    peakElo: 0,
    ...partial,
  })

  it('sorts by xp desc', () => {
    const result = sortLegends([L(1, { xp: 100 }), L(2, { xp: 300 }), L(3, { xp: 200 })], 'xp')
    expect(result.map((l) => l.legendId)).toEqual([2, 3, 1])
  })

  it('sorts by games desc', () => {
    const result = sortLegends([L(1, { games: 10 }), L(2, { games: 30 }), L(3, { games: 20 })], 'games')
    expect(result.map((l) => l.legendId)).toEqual([2, 3, 1])
  })

  it('sorts by winrate desc, with games > 0 ranked above games === 0', () => {
    const a = L(1, { games: 10, wins: 5 })
    const b = L(2, { games: 100, wins: 80 })
    const c = L(3, { games: 0, wins: 0 })
    const result = sortLegends([a, b, c], 'winrate')
    expect(result.map((l) => l.legendId)).toEqual([2, 1, 3])
  })
})
