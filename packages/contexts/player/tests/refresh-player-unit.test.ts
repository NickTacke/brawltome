import { describe, expect, it } from 'bun:test'
import { processRefreshStats } from '../commands/refresh-player'
import { hasStoredRankedRecord } from '../player'

describe('player refresh availability', () => {
  it('rejects when lifetime stats are unavailable', async () => {
    const bhapi = { getPlayerStatsV1: async () => null }

    expect(processRefreshStats({ db: {} as never, bhapi: bhapi as never }, 123)).rejects.toThrow(
      'lifetime stats unavailable',
    )
  })

  it('distinguishes empty ranked state from trusted ranked data', () => {
    expect(hasStoredRankedRecord({ rating: 0, rankedGames: 0, tier: null, rankedLegendCount: 0 })).toBe(false)
    expect(hasStoredRankedRecord({ rating: 1500, rankedGames: 0, tier: null, rankedLegendCount: 0 })).toBe(true)
    expect(hasStoredRankedRecord({ rating: 0, rankedGames: 1, tier: null, rankedLegendCount: 0 })).toBe(true)
    expect(hasStoredRankedRecord({ rating: 0, rankedGames: 0, tier: 'Silver', rankedLegendCount: 0 })).toBe(true)
    expect(hasStoredRankedRecord({ rating: 0, rankedGames: 0, tier: null, rankedLegendCount: 1 })).toBe(true)
  })
})
