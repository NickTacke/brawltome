import { describe, expect, it } from 'bun:test'
import {
  buildLeaderboardQueryString,
  parseLeaderboardSearchParams,
  playerHref,
  preferencesForLeaderboardUpdate,
  snapshotNotice,
} from '../../../src/components/Leaderboard/utils'

describe('parseLeaderboardSearchParams', () => {
  it('preserves established bracket, region, and page URL keys', () => {
    for (const bracket of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
      const result = parseLeaderboardSearchParams(new URLSearchParams(`bracket=${bracket}&region=EU&page=3`))
      expect(result).toEqual({ bracket, region: 'EU', page: 3 })
    }
  })

  it('defaults or bounds invalid values and ignores legacy sorting keys', () => {
    expect(parseLeaderboardSearchParams(new URLSearchParams('bracket=99v99&region=mars&page=abc'))).toEqual({
      bracket: '1v1',
      region: 'all',
      page: 1,
    })
    expect(parseLeaderboardSearchParams(new URLSearchParams('page=9999&sort=wins&order=asc')).page).toBe(500)
    expect(parseLeaderboardSearchParams(new URLSearchParams('page=0')).page).toBe(1)
  })

  it('uses canonical preferences when URL filters are absent or invalid', () => {
    const preferences = {
      version: 1 as const,
      leaderboardBracket: '3v3' as const,
      leaderboardRegion: 'JPN' as const,
    }

    expect(parseLeaderboardSearchParams(new URLSearchParams(), preferences)).toEqual({
      bracket: '3v3',
      region: 'JPN',
      page: 1,
    })
    expect(parseLeaderboardSearchParams(new URLSearchParams('bracket=retired&region=retired'), preferences)).toEqual({
      bracket: '3v3',
      region: 'JPN',
      page: 1,
    })
  })

  it('keeps valid shared URL filters ahead of canonical preferences', () => {
    const preferences = {
      version: 1 as const,
      leaderboardBracket: '3v3' as const,
      leaderboardRegion: 'JPN' as const,
    }

    expect(parseLeaderboardSearchParams(new URLSearchParams('bracket=2v2&region=EU&page=4'), preferences)).toEqual({
      bracket: '2v2',
      region: 'EU',
      page: 4,
    })
  })
})

describe('validated snapshot presentation', () => {
  it('never constructs a player-zero URL', () => {
    expect(playerHref(42)).toBe('/player/42')
    expect(playerHref(0)).toBeNull()
    expect(playerHref(-1)).toBeNull()
  })

  it('distinguishes stale retained rows from first-publication unavailability', () => {
    expect(snapshotNotice('stale')).toBeNull()
    expect(snapshotNotice('unavailable')).toContain('first validated collection')
    expect(snapshotNotice('fresh')).toBeNull()
  })
})

describe('preferencesForLeaderboardUpdate', () => {
  const filters = { bracket: '1v1' as const, region: 'all' as const, page: 3 }

  it('persists signed-in bracket and region changes as the complete V1 contract', () => {
    expect(preferencesForLeaderboardUpdate(filters, { region: 'EU' }, true)).toEqual({
      version: 1,
      leaderboardBracket: '1v1',
      leaderboardRegion: 'EU',
    })
  })

  it('does not persist pagination or anonymous interaction', () => {
    expect(preferencesForLeaderboardUpdate(filters, { page: 4 }, true)).toBeNull()
    expect(preferencesForLeaderboardUpdate(filters, { bracket: '2v2' }, false)).toBeNull()
  })
})

describe('buildLeaderboardQueryString', () => {
  it('round-trips canonical preserved URL keys without legacy sorting', () => {
    const filters = parseLeaderboardSearchParams(new URLSearchParams('bracket=2v2&page=5&region=EU'))
    const params = new URLSearchParams(buildLeaderboardQueryString(filters))
    expect(parseLeaderboardSearchParams(params)).toEqual(filters)
    expect(params.get('bracket')).toBe('2v2')
    expect(params.get('region')).toBe('EU')
    expect(params.get('page')).toBe('5')
    expect(params.get('sort')).toBeNull()
    expect(params.get('order')).toBeNull()
  })
})
