import { describe, expect, test } from 'bun:test'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { applyCurrentSeason } from '../../src/lib/current-season'

const legacy = {
  brawlhallaId: 42,
  name: 'Legacy',
  rating: 2400,
  peakRating: 2500,
  tier: 'Diamond',
  rankedWins: 90,
  rankedGames: 100,
  rankedLegends: [{ legendId: 99 }],
  rankedTeams: [{ brawlhallaIdOne: 42, brawlhallaIdTwo: 99 }],
  ratingHistory: [{ rating: 2400 }],
}

const unavailable: PlayerRankedProfileContract = {
  brawlhallaId: 42,
  checkedAt: '2026-08-09T22:30:00Z',
  lastSuccessAt: null,
  freshness: 'unavailable',
  freshForSeconds: 3600,
  sparsePulse: null,
  snapshot: null,
}

describe('Current Season player adapter', () => {
  test('never falls back to legacy ranked values when canonical state is unavailable', () => {
    expect(applyCurrentSeason(legacy, unavailable)).toMatchObject({
      rating: null,
      peakRating: null,
      tier: null,
      rankedWins: null,
      rankedGames: null,
      rankedLegends: [],
      rankedTeams: [],
      ratingHistory: [],
      currentSeason: unavailable,
    })
  })

  test('preserves measured zero and maps ordered Solo Queue with second player ID zero', () => {
    const currentSeason: PlayerRankedProfileContract = {
      ...unavailable,
      lastSuccessAt: '2026-08-09T22:00:00Z',
      freshness: 'fresh',
      snapshot: {
        oneVsOne: {
          rating: 0,
          peakRating: 782,
          tier: 'Tin 0',
          wins: 0,
          games: 0,
          region: 'US-E',
          globalRank: null,
          regionRank: null,
        },
        rankedLegends: [],
        mainLegend: null,
        fixedTeams: [],
        soloQueue: [
          {
            secondPlayerId: 0,
            teamName: 'Solo Queue',
            rating: 1670,
            peakRating: 1670,
            tier: 'Gold 5',
            wins: 2,
            games: 2,
            region: 'EU',
            globalRank: null,
          },
        ],
        ratingHistory: [],
        observedRatingDirection: null,
      },
    }

    expect(applyCurrentSeason(legacy, currentSeason)).toMatchObject({
      rating: 0,
      rankedGames: 0,
      rankedTeams: [{ brawlhallaIdOne: 42, brawlhallaIdTwo: 0, secondPlayerId: 0 }],
    })
  })
})
