import { describe, expect, test } from 'bun:test'
import {
  coverageBandOf,
  dueCoverageRefreshes,
  isCoverageFresh,
  type RankedCoverageAttempt,
  rankedCoverageMinimumRating,
  summarizeCoverage,
} from '../ranked/coverage-policy'

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs
const now = Date.parse('2026-11-23T12:00:00Z')

function agedBy(ageMs: number): Date {
  return new Date(now - ageMs)
}

function dueIds(
  candidates: { brawlhallaId: number; rating: number; lastSuccessAt: Date | null }[],
  attempts: ReadonlyMap<number, RankedCoverageAttempt> = new Map(),
): number[] {
  return dueCoverageRefreshes({ candidates, attempts, now }).map(({ brawlhallaId }) => brawlhallaId)
}

describe('ranked coverage policy', () => {
  test('puts each rating in the highest band it reaches and leaves players below 1800 out', () => {
    expect(coverageBandOf(2450)?.band).toBe('2200+')
    expect(coverageBandOf(2200)?.band).toBe('2200+')
    expect(coverageBandOf(2199)?.band).toBe('2000-2199')
    expect(coverageBandOf(2000)?.band).toBe('2000-2199')
    expect(coverageBandOf(1800)?.band).toBe('1800-1999')
    expect(coverageBandOf(1799)).toBeNull()
    expect(rankedCoverageMinimumRating).toBe(1800)
  })

  test('refreshes 2200+ daily, 2000-2199 every two days and 1800-1999 weekly', () => {
    const candidates = [
      { brawlhallaId: 1, rating: 2300, lastSuccessAt: agedBy(23 * hourMs) },
      { brawlhallaId: 2, rating: 2300, lastSuccessAt: agedBy(25 * hourMs) },
      { brawlhallaId: 3, rating: 2100, lastSuccessAt: agedBy(47 * hourMs) },
      { brawlhallaId: 4, rating: 2100, lastSuccessAt: agedBy(49 * hourMs) },
      { brawlhallaId: 5, rating: 1900, lastSuccessAt: agedBy(6 * dayMs) },
      { brawlhallaId: 6, rating: 1900, lastSuccessAt: agedBy(8 * dayMs) },
      { brawlhallaId: 7, rating: 1700, lastSuccessAt: null },
    ]

    expect(dueIds(candidates).sort()).toEqual([2, 4, 6])

    expect(candidates.map((candidate) => isCoverageFresh(candidate, now))).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ])
  })

  test('orders never-refreshed players first, then the stalest, whatever their band', () => {
    const candidates = [
      { brawlhallaId: 10, rating: 2300, lastSuccessAt: agedBy(2 * dayMs) },
      { brawlhallaId: 11, rating: 1850, lastSuccessAt: agedBy(30 * dayMs) },
      { brawlhallaId: 12, rating: 2050, lastSuccessAt: null },
      { brawlhallaId: 13, rating: 2150, lastSuccessAt: agedBy(3 * dayMs) },
      { brawlhallaId: 9, rating: 1990, lastSuccessAt: null },
    ]

    expect(dueIds(candidates)).toEqual([9, 12, 11, 13, 10])
  })

  test('skips players the planner tried within their interval, and for a week after a dead letter', () => {
    const candidates = [20, 21, 22, 23].map((brawlhallaId) => ({ brawlhallaId, rating: 2300, lastSuccessAt: null }))

    const attempts = new Map<number, RankedCoverageAttempt>([
      [20, { lastPlannedAt: agedBy(3 * hourMs), lastFailedAt: null }],
      [21, { lastPlannedAt: agedBy(25 * hourMs), lastFailedAt: null }],
      [22, { lastPlannedAt: agedBy(5 * dayMs), lastFailedAt: agedBy(5 * dayMs) }],
      [23, { lastPlannedAt: agedBy(8 * dayMs), lastFailedAt: agedBy(8 * dayMs) }],
    ])

    expect(dueIds(candidates, attempts)).toEqual([21, 23])
  })

  test('counts every band and profile age, empty combinations included', () => {
    const summary = summarizeCoverage(
      [
        { brawlhallaId: 1, rating: 2300, lastSuccessAt: agedBy(2 * hourMs) },
        { brawlhallaId: 2, rating: 2250, lastSuccessAt: agedBy(30 * hourMs) },
        { brawlhallaId: 3, rating: 2100, lastSuccessAt: null },
        { brawlhallaId: 4, rating: 1900, lastSuccessAt: agedBy(10 * dayMs) },
        { brawlhallaId: 5, rating: 1500, lastSuccessAt: null },
      ],
      now,
    )

    expect(summary).toHaveLength(15)

    expect(summary.filter(({ players }) => players > 0)).toEqual([
      { band: '2200+', age: 'under_1_day', players: 1 },
      { band: '2200+', age: '1_to_2_days', players: 1 },
      { band: '2000-2199', age: 'missing', players: 1 },
      { band: '1800-1999', age: 'over_7_days', players: 1 },
    ])
  })
})
