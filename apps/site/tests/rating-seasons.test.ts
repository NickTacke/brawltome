import { describe, expect, test } from 'bun:test'
import { type Season, seasonsWithPoints, shownSeasons } from '../src/components/player/rating-seasons'

function point(recordedAt: string, rating = 1500) {
  return {
    rating,
    peakRating: rating,
    tier: 'Gold 1',
    wins: 1,
    games: 2,
    source: 'v0-player-snapshot' as const,
    recordedAt,
  }
}

const seasonStarts = [
  { season: 39, startsAt: '1970-01-01T00:00:00.000Z' },
  { season: 40, startsAt: '2026-03-25T14:00:00.000Z' },
]

function ids(seasons: Season[]): number[] {
  return seasons.map((season) => season.id)
}

describe('seasonsWithPoints', () => {
  test('a point exactly at a start belongs to the new season', () => {
    const history = [
      point('2026-03-01T00:00:00.000Z'),
      point('2026-03-25T13:59:59.000Z'),
      point('2026-03-25T14:00:00.000Z'),
      point('2026-03-26T00:00:00.000Z'),
    ]

    const seasons = seasonsWithPoints(history, seasonStarts)

    expect(ids(seasons)).toEqual([40, 39])
    expect(seasons[0]?.points).toHaveLength(2)
    expect(seasons[0]?.points[0]?.recordedAt).toBe('2026-03-25T14:00:00.000Z')
  })

  test('sorts the points of a season by time', () => {
    const history = [point('2026-03-27T00:00:00.000Z', 1600), point('2026-03-26T00:00:00.000Z', 1500)]

    expect(seasonsWithPoints(history, seasonStarts)[0]?.points.map(({ rating }) => rating)).toEqual([1500, 1600])
  })

  test('leaves out a season with one point', () => {
    const history = [
      point('2026-03-01T00:00:00.000Z'),
      point('2026-03-26T00:00:00.000Z'),
      point('2026-03-27T00:00:00.000Z'),
    ]

    expect(ids(seasonsWithPoints(history, seasonStarts))).toEqual([40])
  })

  test('no season starts gives no seasons', () => {
    expect(seasonsWithPoints([point('2026-03-26T00:00:00.000Z')], [])).toEqual([])
  })

  test('no history gives no seasons', () => {
    expect(seasonsWithPoints([], seasonStarts)).toEqual([])
  })
})

describe('shownSeasons', () => {
  const seasons: Season[] = [47, 46, 45, 44, 43, 42].map((id) => ({ id, points: [] }))

  test('shows the newest four', () => {
    expect(ids(shownSeasons(seasons, '47'))).toEqual([47, 46, 45, 44])
  })

  test('an older pick replaces only the fourth tile', () => {
    expect(ids(shownSeasons(seasons, '42'))).toEqual([47, 46, 45, 42])
  })

  test('a season already on show changes nothing', () => {
    expect(ids(shownSeasons(seasons, '45'))).toEqual([47, 46, 45, 44])
  })
})
