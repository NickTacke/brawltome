import { describe, expect, test } from 'bun:test'
import {
  type PlayerRankedProfileContract,
  parsePlayerRankedProfileOutput,
  playerRankedProfileSchema,
} from '../src/player-ranked'

const rankedSnapshot: NonNullable<PlayerRankedProfileContract['snapshot']> = {
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
  mainLegend: { legendId: 3, legendNameKey: 'bodvar', source: 'career' },
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
}

const profile: PlayerRankedProfileContract = {
  brawlhallaId: 91913839,
  checkedAt: '2026-08-09T22:00:00Z',
  lastSuccessAt: '2026-08-09T22:00:00Z',
  freshness: 'fresh',
  freshForSeconds: 3600,
  sparsePulse: null,
  snapshot: rankedSnapshot,
}

describe('Player ranked profile contract', () => {
  test('preserves measured zero, nullable placement, separate Solo Queue, and freshness evidence', () => {
    expect(parsePlayerRankedProfileOutput(profile)).toEqual(profile)
    expect(
      parsePlayerRankedProfileOutput({
        ...profile,
        lastSuccessAt: null,
        freshness: 'unavailable',
        snapshot: null,
      }),
    ).toMatchObject({ checkedAt: profile.checkedAt, lastSuccessAt: null, snapshot: null })
  })

  test('compares pulse timestamps by instant rather than ISO string shape', () => {
    expect(() =>
      parsePlayerRankedProfileOutput({
        ...profile,
        sparsePulse: {
          checkedAt: '2026-08-09T22:00:00Z',
          lastSuccessAt: '2026-08-09T22:00:00.500Z',
        },
      }),
    ).toThrow()
  })

  test('publishes separate sparse pulse evidence and coverage-bounded observed direction', () => {
    const withObservations = {
      ...profile,
      sparsePulse: {
        checkedAt: '2026-08-09T22:30:00Z',
        lastSuccessAt: '2026-08-09T22:29:00Z',
      },
      snapshot: {
        ...rankedSnapshot,
        ratingHistory: [
          {
            source: 'v0-player-snapshot' as const,
            rating: 1_650,
            peakRating: 1_700,
            tier: 'Gold 5',
            wins: 6,
            games: 12,
            recordedAt: '2026-08-09T22:00:00Z',
          },
          {
            source: 'legacy-v2' as const,
            rating: 1_600,
            peakRating: 1_650,
            tier: null,
            wins: 5,
            games: 10,
            recordedAt: '2026-08-09T20:00:00Z',
          },
        ],
        observedRatingDirection: {
          direction: 'up' as const,
          ratingChange: 50,
          observationCount: 2,
          fromObservedAt: '2026-08-09T20:00:00Z',
          toObservedAt: '2026-08-09T22:00:00Z',
        },
      },
    }

    expect(parsePlayerRankedProfileOutput(withObservations)).toEqual(withObservations)
  })

  test.each([
    { ...profile, checkedAt: undefined },
    { ...profile, freshForSeconds: 3599 },
    { ...profile, snapshot: { ...rankedSnapshot, rankedLegends: undefined } },
    {
      ...profile,
      snapshot: {
        ...rankedSnapshot,
        soloQueue: [{ ...rankedSnapshot.soloQueue[0], secondPlayerId: 42 }],
      },
    },
    {
      ...profile,
      snapshot: { ...rankedSnapshot, oneVsOne: { ...rankedSnapshot.oneVsOne, rating: null } },
    },
    {
      ...profile,
      snapshot: { ...rankedSnapshot, oneVsOne: { ...rankedSnapshot.oneVsOne, tier: ' \u200B' } },
    },
    { ...profile, lastSuccessAt: null, freshness: 'unavailable' },
    {
      ...profile,
      sparsePulse: { checkedAt: '2026-08-09T22:00:00Z', lastSuccessAt: '2026-08-09T22:01:00Z' },
    },
  ])('rejects malformed or partial output %#', (value) => {
    expect(() => playerRankedProfileSchema.parse(value)).toThrow()
  })
})
