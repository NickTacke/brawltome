import { describe, expect, it } from 'bun:test'
import { buildLeaderboardQueryString, parseLeaderboardSearchParams } from '../../../src/components/Leaderboard/utils'

describe('parseLeaderboardSearchParams', () => {
  it('returns defaults for empty params', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams())
    expect(result.bracket).toBe('1v1')
    expect(result.region).toBe('all')
    expect(result.page).toBe(1)
  })

  it('rejects invalid bracket', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('bracket=99v99'))
    expect(result.bracket).toBe('1v1')
  })

  it('accepts valid bracket', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('bracket=2v2'))
    expect(result.bracket).toBe('2v2')
  })

  it('accepts solo2v2 bracket', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('bracket=solo2v2'))
    expect(result.bracket).toBe('solo2v2')
  })

  it('accepts 3v3 bracket', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('bracket=3v3'))
    expect(result.bracket).toBe('3v3')
  })

  it('clamps NaN page to 1', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('page=abc'))
    expect(result.page).toBe(1)
  })

  it('clamps page to max', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('page=9999'))
    expect(result.page).toBe(500)
  })

  it('clamps page below 1 to 1', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('page=0'))
    expect(result.page).toBe(1)
  })

  it('rejects invalid region', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('region=mars'))
    expect(result.region).toBe('all')
  })

  it('accepts valid region', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('region=EU'))
    expect(result.region).toBe('EU')
  })

  it('ignores legacy sort and order params', () => {
    const result = parseLeaderboardSearchParams(new URLSearchParams('sort=wins&order=asc'))
    expect(result).toEqual({ bracket: '1v1', region: 'all', page: 1 })
  })
})

describe('buildLeaderboardQueryString', () => {
  it('round-trips through parse', () => {
    const filters = parseLeaderboardSearchParams(new URLSearchParams('bracket=2v2&page=5&region=EU'))
    const qs = buildLeaderboardQueryString(filters)
    const reparsed = parseLeaderboardSearchParams(new URLSearchParams(qs))
    expect(reparsed).toEqual(filters)
  })

  it('emits canonical keys for the URL contract', () => {
    const qs = buildLeaderboardQueryString({
      bracket: '2v2',
      region: 'EU',
      page: 3,
    })
    const params = new URLSearchParams(qs)
    expect(params.get('bracket')).toBe('2v2')
    expect(params.get('region')).toBe('EU')
    expect(params.get('page')).toBe('3')
    expect(params.get('sort')).toBeNull()
    expect(params.get('order')).toBeNull()
  })
})
