import { describe, expect, test } from 'bun:test'
import type { RankedPlayerQueries } from '@brawltome/player'
import type { PlayerValhallanQueries } from '@brawltome/ranking'
import { createPlayerRankedRouter } from '../src/router/player-ranked.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-ranked-test-secret'

function callerFor(
  rankedPlayerQueries: RankedPlayerQueries,
  playerValhallanQueries: PlayerValhallanQueries = { playerValhallanEvidenceById: async () => null },
) {
  const context = { internalSecret: secret, rankedPlayerQueries, rankingQueries: playerValhallanQueries } as Context
  return createPlayerRankedRouter(createInternalProcedure(secret)).createCaller(context)
}

describe('player.rankedById', () => {
  test('prefers official Valhallan evidence for matching player rankings only', async () => {
    const observedAt = new Date('2026-08-09T22:00:00Z')
    const rankedPlayerQueries: RankedPlayerQueries = {
      byId: async (brawlhallaId) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: observedAt,
        freshness: 'fresh',
        freshForSeconds: 3600,
        sparsePulse: null,
        snapshot: {
          oneVsOne: {
            rating: 2500,
            peakRating: 2550,
            tier: 'Diamond',
            wins: 20,
            games: 30,
            region: 'US-E',
            globalRank: null,
            regionRank: null,
          },
          rankedLegends: [],
          mainLegend: null,
          fixedTeams: [
            {
              brawlhallaIdOne: 42,
              brawlhallaIdTwo: 43,
              teamName: 'Player + Match',
              rating: 2500,
              peakRating: 2550,
              tier: 'Diamond',
              wins: 20,
              games: 30,
              region: 'US-E',
              globalRank: null,
            },
            {
              brawlhallaIdOne: 42,
              brawlhallaIdTwo: 44,
              teamName: 'Player + No Match',
              rating: 2400,
              peakRating: 2450,
              tier: 'Diamond',
              wins: 10,
              games: 20,
              region: 'US-E',
              globalRank: null,
            },
          ],
          soloQueue: [
            {
              secondPlayerId: 0,
              teamName: 'Player',
              rating: 2500,
              peakRating: 2550,
              tier: 'Diamond',
              wins: 20,
              games: 30,
              region: 'US-E',
              globalRank: null,
            },
            {
              secondPlayerId: 0,
              teamName: 'Player',
              rating: 1700,
              peakRating: 1750,
              tier: 'Gold 5',
              wins: 10,
              games: 20,
              region: 'EU',
              globalRank: null,
            },
          ],
          ratingHistory: [],
          observedRatingDirection: null,
        },
      }),
    }
    const playerValhallanQueries: PlayerValhallanQueries = {
      playerValhallanEvidenceById: async () => ({
        oneVsOne: true,
        fixedTwoVsTwoTeams: [{ brawlhallaIdOne: 42, brawlhallaIdTwo: 43 }],
        soloTwoVsTwo: true,
      }),
    }

    await expect(callerFor(rankedPlayerQueries, playerValhallanQueries).rankedById({ id: 42 })).resolves.toMatchObject({
      snapshot: {
        oneVsOne: { tier: 'Valhallan' },
        fixedTeams: [{ tier: 'Valhallan' }, { tier: 'Diamond' }],
        soloQueue: [{ tier: 'Valhallan' }, { tier: 'Gold 5' }],
      },
    })
  })

  test('publishes an unavailable 1v1 region as null instead of failing the profile', async () => {
    const observedAt = new Date('2026-08-09T22:00:00Z')
    const caller = callerFor({
      byId: async (brawlhallaId) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: observedAt,
        freshness: 'fresh',
        freshForSeconds: 3600,
        sparsePulse: null,
        snapshot: {
          oneVsOne: {
            rating: 0,
            peakRating: 0,
            tier: 'none',
            wins: 0,
            games: 0,
            region: '',
            globalRank: null,
            regionRank: null,
          },
          rankedLegends: [],
          mainLegend: null,
          fixedTeams: [],
          soloQueue: [],
          ratingHistory: [],
          observedRatingDirection: null,
        },
      }),
    })

    await expect(caller.rankedById({ id: 77_474_487 })).resolves.toMatchObject({
      snapshot: { oneVsOne: { region: null } },
    })
  })

  test('maps Players dates into canonical output and rejects malformed producer values', async () => {
    const observedAt = new Date('2026-08-09T22:00:00Z')
    const caller = callerFor({
      byId: async (brawlhallaId) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: observedAt,
        freshness: 'fresh',
        freshForSeconds: 3600,
        sparsePulse: { checkedAt: observedAt, lastSuccessAt: observedAt },
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
          soloQueue: [],
          ratingHistory: [
            {
              source: 'v0-player-snapshot',
              rating: 0,
              peakRating: 782,
              tier: 'Tin 0',
              wins: 0,
              games: 0,
              recordedAt: observedAt,
            },
            {
              source: 'legacy-v2',
              rating: 100,
              peakRating: 782,
              tier: 'Tin 0',
              wins: 1,
              games: 0,
              recordedAt: new Date('2026-08-09T21:55:00Z'),
            },
          ],
          observedRatingDirection: {
            direction: 'down',
            ratingChange: -100,
            observationCount: 2,
            fromObservedAt: new Date('2026-08-09T21:55:00Z'),
            toObservedAt: observedAt,
          },
        },
      }),
    })

    await expect(caller.rankedById({ id: 42 })).resolves.toMatchObject({
      checkedAt: '2026-08-09T22:00:00.000Z',
      lastSuccessAt: '2026-08-09T22:00:00.000Z',
      sparsePulse: {
        checkedAt: '2026-08-09T22:00:00.000Z',
        lastSuccessAt: '2026-08-09T22:00:00.000Z',
      },
      snapshot: {
        oneVsOne: { rating: 0 },
        fixedTeams: [],
        soloQueue: [],
        observedRatingDirection: {
          direction: 'down',
          ratingChange: -100,
          fromObservedAt: '2026-08-09T21:55:00.000Z',
          toObservedAt: '2026-08-09T22:00:00.000Z',
        },
      },
    })

    await expect(caller.rankedById({ id: 0 })).rejects.toThrow()

    const malformedProducer = {
      byId: async (brawlhallaId: number) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: null,
        freshness: 'unavailable',
        freshForSeconds: 42,
        snapshot: null,
      }),
    } as unknown as RankedPlayerQueries
    await expect(callerFor(malformedProducer).rankedById({ id: 42 })).rejects.toThrow()
  })
})
