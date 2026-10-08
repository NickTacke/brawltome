import { describe, expect, test } from 'bun:test'
import { freshnessLabel, oneVsOneFreshness, refreshFreshness } from '../../src/lib/section-freshness'

const oneVsOne = { rating: 1_800, peakRating: 1_850, wins: 60, games: 100 }
const rankedProfile = { lastSuccessAt: '2026-10-08T09:00:00Z', snapshot: { oneVsOne } }

describe('oneVsOneFreshness', () => {
  test('labels the leaderboard standing when there is no V0 snapshot', () => {
    expect(
      oneVsOneFreshness({ lastSuccessAt: null, snapshot: null }, { ...oneVsOne, observedAt: '2026-10-08T11:48:00Z' }),
    ).toEqual({ at: '2026-10-08T11:48:00Z', source: 'leaderboard' })
    expect(oneVsOneFreshness(null, { ...oneVsOne, observedAt: '2026-10-08T11:48:00Z' })).toEqual({
      at: '2026-10-08T11:48:00Z',
      source: 'leaderboard',
    })
  })

  test('returns nothing without a snapshot or a standing', () => {
    expect(oneVsOneFreshness({ lastSuccessAt: null, snapshot: null }, null)).toBeNull()
    expect(oneVsOneFreshness(null, undefined)).toBeNull()
  })

  test('uses the V0 refresh when no standing is known', () => {
    expect(oneVsOneFreshness(rankedProfile, null)).toEqual({ at: '2026-10-08T09:00:00Z', source: 'refresh' })
    expect(oneVsOneFreshness(rankedProfile, undefined)).toEqual({ at: '2026-10-08T09:00:00Z', source: 'refresh' })
  })

  test('recognises a newer leaderboard observation the API overlaid onto the snapshot', () => {
    expect(oneVsOneFreshness(rankedProfile, { ...oneVsOne, observedAt: '2026-10-08T11:48:00Z' })).toEqual({
      at: '2026-10-08T11:48:00Z',
      source: 'leaderboard',
    })
  })

  test('keeps the refresh time when the standing is not newer than the refresh', () => {
    for (const observedAt of ['2026-10-08T08:00:00Z', '2026-10-08T09:00:00Z']) {
      expect(oneVsOneFreshness(rankedProfile, { ...oneVsOne, observedAt })).toEqual({
        at: '2026-10-08T09:00:00Z',
        source: 'refresh',
      })
    }
  })

  test('keeps the refresh time when the shown 1v1 numbers did not come from the standing', () => {
    for (const changed of [{ rating: 1_810 }, { peakRating: 1_900 }, { wins: 61 }, { games: 101 }]) {
      expect(oneVsOneFreshness(rankedProfile, { ...oneVsOne, ...changed, observedAt: '2026-10-08T11:48:00Z' })).toEqual(
        { at: '2026-10-08T09:00:00Z', source: 'refresh' },
      )
    }
  })

  test('ignores an unparseable observation time', () => {
    expect(oneVsOneFreshness(rankedProfile, { ...oneVsOne, observedAt: 'not-a-date' })).toEqual({
      at: '2026-10-08T09:00:00Z',
      source: 'refresh',
    })
    expect(oneVsOneFreshness(null, { ...oneVsOne, observedAt: 'not-a-date' })).toBeNull()
  })
})

describe('refreshFreshness', () => {
  test('labels a fetched V0 section with its refresh time', () => {
    expect(refreshFreshness('2026-10-08T09:00:00Z')).toEqual({ at: '2026-10-08T09:00:00Z', source: 'refresh' })
  })

  test('returns nothing for a section that was never fetched', () => {
    expect(refreshFreshness(null)).toBeNull()
    expect(refreshFreshness(undefined)).toBeNull()
    expect(refreshFreshness('not-a-date')).toBeNull()
  })
})

describe('freshnessLabel', () => {
  const now = new Date('2026-10-08T12:00:00Z')

  test('names the leaderboard as the source, compactly on phones', () => {
    expect(freshnessLabel({ at: '2026-10-08T11:48:00Z', source: 'leaderboard' }, now)).toEqual({
      prefix: 'From leaderboard',
      compactPrefix: 'Leaderboard',
      age: '12m ago',
    })
  })

  test('shows only the age on phones for a V0 refresh', () => {
    expect(freshnessLabel({ at: new Date('2026-10-08T10:00:00Z'), source: 'refresh' }, now)).toEqual({
      prefix: 'Updated',
      compactPrefix: null,
      age: '2h ago',
    })
  })
})
