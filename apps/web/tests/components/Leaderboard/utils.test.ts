import { describe, expect, it } from 'bun:test'
import {
  buildLeaderboardQueryString,
  leaderboardPageFeatures,
  parseLeaderboardSearchParams,
  playerHref,
  preferencesForLeaderboardUpdate,
  shouldWaitForPreferences,
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
      version: 2 as const,
      leaderboardBracket: '3v3' as const,
      leaderboardRegion: 'JPN' as const,
      theme: 'purple' as const,
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
      version: 2 as const,
      leaderboardBracket: '3v3' as const,
      leaderboardRegion: 'JPN' as const,
      theme: 'purple' as const,
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

  it('persists signed-in bracket and region changes as a field patch', () => {
    expect(preferencesForLeaderboardUpdate(filters, { region: 'EU' }, true)).toEqual({
      leaderboardBracket: '1v1',
      leaderboardRegion: 'EU',
    })
  })

  it('does not persist pagination or anonymous interaction', () => {
    expect(preferencesForLeaderboardUpdate(filters, { page: 4 }, true)).toBeNull()
    expect(preferencesForLeaderboardUpdate(filters, { bracket: '2v2' }, false)).toBeNull()
  })
})

describe('shouldWaitForPreferences', () => {
  it('never waits once preferences are settled, or for anonymous and still-resolving accounts', () => {
    expect(shouldWaitForPreferences(new URLSearchParams(), false)).toBe(false)
    expect(shouldWaitForPreferences(new URLSearchParams('page=3'), false)).toBe(false)
  })

  it('waits while loading preferences could still pick the bracket or region', () => {
    expect(shouldWaitForPreferences(new URLSearchParams(), true)).toBe(true)
    expect(shouldWaitForPreferences(new URLSearchParams('page=4'), true)).toBe(true)
    expect(shouldWaitForPreferences(new URLSearchParams('bracket=2v2'), true)).toBe(true)
    expect(shouldWaitForPreferences(new URLSearchParams('region=EU'), true)).toBe(true)
  })

  it('treats invalid URL filters as absent because preferences replace them', () => {
    expect(shouldWaitForPreferences(new URLSearchParams('bracket=99v99&region=EU'), true)).toBe(true)
    expect(shouldWaitForPreferences(new URLSearchParams('bracket=2v2&region=mars'), true)).toBe(true)
  })

  it('starts immediately when the URL names a valid bracket and region', () => {
    expect(shouldWaitForPreferences(new URLSearchParams('bracket=2v2&region=EU'), true)).toBe(false)
    expect(shouldWaitForPreferences(new URLSearchParams('bracket=1v1&region=all&page=7'), true)).toBe(false)
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

describe('leaderboardPageFeatures', () => {
  it('reports page_next only when moving forward', () => {
    expect(leaderboardPageFeatures(2, { page: 3 })).toEqual(['leaderboard.page_next'])
    expect(leaderboardPageFeatures(3, { page: 2 })).toEqual([])
    expect(leaderboardPageFeatures(3, { page: 3 })).toEqual([])
  })

  it('reports page_depth_5plus only when crossing from below 5 to 5 or more', () => {
    expect(leaderboardPageFeatures(4, { page: 5 })).toEqual(['leaderboard.page_next', 'leaderboard.page_depth_5plus'])
    expect(leaderboardPageFeatures(5, { page: 6 })).toEqual(['leaderboard.page_next'])
    expect(leaderboardPageFeatures(8, { page: 2 })).toEqual([])
  })

  it('ignores bracket and region changes and updates without a page', () => {
    expect(leaderboardPageFeatures(1, { bracket: '2v2', page: 1 })).toEqual([])
    expect(leaderboardPageFeatures(1, { region: 'EU', page: 5 })).toEqual([])
    expect(leaderboardPageFeatures(1, {})).toEqual([])
  })
})
