import { describe, expect, test } from 'bun:test'
import { RANKED_FRESHNESS_SECONDS, deriveObservedRatingDirection, rankedFreshness } from '../ranked/model'

describe('ranked freshness', () => {
  test('uses last success with an inclusive one-hour freshness boundary', () => {
    const lastSuccess = new Date('2026-08-09T22:00:00Z')

    expect(RANKED_FRESHNESS_SECONDS).toBe(3600)
    expect(rankedFreshness(null, new Date('2026-08-09T22:30:00Z'))).toBe('unavailable')
    expect(rankedFreshness(lastSuccess, new Date('2026-08-09T23:00:00Z'))).toBe('fresh')
    expect(rankedFreshness(lastSuccess, new Date('2026-08-09T23:00:00.001Z'))).toBe('stale')
  })
})

describe('observed rating direction', () => {
  const point = (rating: number, games: number, recordedAt: string) => ({
    source: 'v0-player-snapshot' as const,
    rating,
    peakRating: rating,
    tier: 'Gold 1',
    wins: Math.floor(games / 2),
    games,
    recordedAt: new Date(recordedAt),
  })

  test('compares only the latest monotonic-games segment from newest-first owned observations', () => {
    expect(
      deriveObservedRatingDirection([
        point(1_650, 12, '2026-08-09T22:00:00Z'),
        point(1_600, 10, '2026-08-09T20:00:00Z'),
        point(1_900, 200, '2026-08-01T20:00:00Z'),
        point(1_850, 190, '2026-07-31T20:00:00Z'),
      ]),
    ).toEqual({
      direction: 'up',
      ratingChange: 50,
      observationCount: 2,
      fromObservedAt: new Date('2026-08-09T20:00:00Z'),
      toObservedAt: new Date('2026-08-09T22:00:00Z'),
    })
  })

  test('returns unavailable coverage until the latest segment has two observations', () => {
    expect(
      deriveObservedRatingDirection([
        point(1_600, 0, '2026-08-09T22:00:00Z'),
        point(1_900, 200, '2026-08-01T20:00:00Z'),
      ]),
    ).toBeNull()
    expect(deriveObservedRatingDirection([])).toBeNull()
  })
})
