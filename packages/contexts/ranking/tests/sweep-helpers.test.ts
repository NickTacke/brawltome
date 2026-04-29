import { describe, expect, it } from 'bun:test'
import { normalizeRegion, resolveTier } from '../commands/sweep-helpers'

describe('normalizeRegion', () => {
  it('maps JPS -> JPN (the only divergent region)', () => {
    expect(normalizeRegion('JPS')).toBe('JPN')
  })
  it('passes through canonical region codes unchanged', () => {
    for (const r of ['US-E', 'US-W', 'EU', 'SEA', 'BRZ', 'AUS', 'JPN', 'ME', 'SA']) {
      expect(normalizeRegion(r)).toBe(r)
    }
  })
  it('passes through unknown codes unchanged', () => {
    expect(normalizeRegion('XYZ')).toBe('XYZ')
  })
})

describe('resolveTier', () => {
  it('returns api tier verbatim when present', () => {
    expect(resolveTier({ apiTier: 'Diamond', bestRating: 1500 })).toEqual({ tier: 'Diamond', fallback: 'none' })
    expect(resolveTier({ apiTier: 'Valhallan', bestRating: 2400 })).toEqual({ tier: 'Valhallan', fallback: 'none' })
    expect(resolveTier({ apiTier: 'Tin 1', bestRating: 100 })).toEqual({ tier: 'Tin 1', fallback: 'none' })
  })

  it('returns Diamond when api tier missing AND best_rating >= 2000 ("ex-Valhallan")', () => {
    expect(resolveTier({ apiTier: undefined, bestRating: 2000 })).toEqual({ tier: 'Diamond', fallback: 'diamond' })
    expect(resolveTier({ apiTier: undefined, bestRating: 2400 })).toEqual({ tier: 'Diamond', fallback: 'diamond' })
  })

  it('returns rating-bucket when api tier missing AND best_rating < 2000 (defensive, unobserved)', () => {
    const cases: Array<[number, string]> = [
      [1999, 'Platinum'],
      [1700, 'Platinum'],
      [1699, 'Gold'],
      [1400, 'Gold'],
      [1399, 'Silver'],
      [1200, 'Silver'],
      [1199, 'Bronze'],
      [1000, 'Bronze'],
      [999, 'Tin'],
      [0, 'Tin'],
    ]
    for (const [bestRating, expectedTier] of cases) {
      const r = resolveTier({ apiTier: undefined, bestRating })
      expect(r.tier).toBe(expectedTier)
      expect(r.fallback).toBe('unexpected_null')
    }
  })
})
