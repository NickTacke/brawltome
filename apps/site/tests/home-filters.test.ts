import { describe, expect, test } from 'bun:test'
import { leaderboardPageInputSchema } from '@brawltome/contracts'
import { bracketOptions, parseMode, parseRegion } from '../src/components/home/home-filters'
import { pickRegion, regionCookieName, regionCookieText } from '../src/components/home/region-cookie'
import { regionOptions } from '../src/components/regions'

describe('filter options', () => {
  const { mode, region } = leaderboardPageInputSchema.shape

  test('offer every bracket the api has, and no other', () => {
    expect(bracketOptions.map(({ value }) => value)).toEqual(mode.options)
  })

  test('offer every region the api has, and no other', () => {
    expect(regionOptions.map(({ value }) => value)).toEqual(region.options)
  })
})

describe('parseMode', () => {
  test('keeps a known bracket', () => {
    expect(parseMode('solo2v2')).toBe('solo2v2')
  })

  test.each([undefined, '', '4v4', 3])('%p falls back to 1v1', (value) => {
    expect(parseMode(value)).toBe('1v1')
  })
})

describe('parseRegion', () => {
  test('keeps a known region', () => {
    expect(parseRegion('US-E')).toBe('US-E')
  })

  test.each([undefined, '', 'eu', 'Mars', 7])('%p is not a region', (value) => {
    expect(parseRegion(value)).toBeUndefined()
  })
})

describe('pickRegion', () => {
  test('the region in the address wins over the remembered one', () => {
    expect(pickRegion('JPN', 'EU')).toBe('JPN')
  })

  test('without one in the address, the remembered region is used', () => {
    expect(pickRegion(undefined, 'EU')).toBe('EU')
  })

  test('a first visit sees the global board', () => {
    expect(pickRegion(undefined, undefined)).toBe('all')
  })

  test('a tampered cookie sees the global board', () => {
    expect(pickRegion(undefined, '<script>')).toBe('all')
  })
})

describe('regionCookieText', () => {
  test('remembers the region for a year across the whole site', () => {
    expect(regionCookieText('SEA')).toBe(`${regionCookieName}=SEA; max-age=31536000; path=/; samesite=lax`)
  })
})
