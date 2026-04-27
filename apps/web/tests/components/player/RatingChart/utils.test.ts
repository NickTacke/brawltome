import { describe, expect, it } from 'bun:test'
import {
  SEASONS,
  TIER_THRESHOLDS,
  getCurrentSeason,
  getTierFromRating,
  prepareChartData,
} from '../../../../src/components/player/RatingChart/utils'

describe('prepareChartData', () => {
  it('returns empty array for empty input', () => {
    expect(prepareChartData([])).toEqual([])
  })

  it('produces an entry per input with formatted date', () => {
    const result = prepareChartData([
      {
        rating: 1500,
        peakRating: 1500,
        tier: null,
        games: 0,
        wins: 0,
        recordedAt: new Date(Date.UTC(2026, 2, 15)),
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].rating).toBe(1500)
    expect(typeof result[0].date).toBe('string')
  })

  it('sorts entries by recordedAt ascending', () => {
    const result = prepareChartData([
      {
        rating: 1600,
        peakRating: 1600,
        tier: null,
        games: 12,
        wins: 7,
        recordedAt: new Date(Date.UTC(2026, 2, 16)),
      },
      {
        rating: 1500,
        peakRating: 1500,
        tier: null,
        games: 10,
        wins: 5,
        recordedAt: new Date(Date.UTC(2026, 2, 15)),
      },
    ])
    expect(result.map((p) => p.rating)).toEqual([1500, 1600])
  })

  it('filters out entries with invalid recordedAt', () => {
    const result = prepareChartData([
      {
        rating: 1500,
        peakRating: 1500,
        tier: null,
        games: 0,
        wins: 0,
        recordedAt: 'not a date',
      },
      {
        rating: 1600,
        peakRating: 1600,
        tier: null,
        games: 0,
        wins: 0,
        recordedAt: new Date(Date.UTC(2026, 2, 15)).toISOString(),
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].rating).toBe(1600)
  })
})

describe('getCurrentSeason', () => {
  it('returns the latest season starting on or before now', () => {
    const seasons = [
      { id: 39, name: 'Season 39', startsAt: new Date(Date.UTC(2025, 11, 1)) },
      { id: 40, name: 'Season 40', startsAt: new Date(Date.UTC(2026, 2, 25)) },
    ]
    const now = new Date(Date.UTC(2026, 3, 1))
    expect(getCurrentSeason(now, seasons).id).toBe(40)
  })

  it('returns prior season when now is before next season starts', () => {
    const seasons = [
      { id: 39, name: 'Season 39', startsAt: new Date(Date.UTC(2025, 11, 1)) },
      { id: 40, name: 'Season 40', startsAt: new Date(Date.UTC(2026, 2, 25)) },
    ]
    const now = new Date(Date.UTC(2026, 1, 1))
    expect(getCurrentSeason(now, seasons).id).toBe(39)
  })

  it('returns first season for dates before any season starts', () => {
    const seasons = [{ id: 39, name: 'Season 39', startsAt: new Date(Date.UTC(2025, 11, 1)) }]
    const now = new Date(Date.UTC(2025, 5, 1))
    expect(getCurrentSeason(now, seasons).id).toBe(39)
  })

  it('uses the SEASONS config by default', () => {
    expect(SEASONS.length).toBeGreaterThan(0)
    const result = getCurrentSeason(new Date(Date.UTC(2030, 0, 1)))
    expect(SEASONS).toContain(result)
  })
})

describe('getTierFromRating', () => {
  it('returns the lowest tier for ratings below first threshold', () => {
    const sorted = [...TIER_THRESHOLDS].sort((a, b) => a.minRating - b.minRating)
    const lowest = sorted[0]
    expect(getTierFromRating(lowest.minRating - 1)).toBe(lowest.name)
  })

  it('returns each tier name at its boundary', () => {
    for (const t of TIER_THRESHOLDS) {
      expect(getTierFromRating(t.minRating)).toBe(t.name)
    }
  })

  it('returns the highest tier for ratings above the cap', () => {
    const sorted = [...TIER_THRESHOLDS].sort((a, b) => a.minRating - b.minRating)
    const top = sorted[sorted.length - 1]
    expect(getTierFromRating(top.minRating + 1000)).toBe(top.name)
  })
})
