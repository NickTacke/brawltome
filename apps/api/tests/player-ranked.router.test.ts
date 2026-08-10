import { describe, expect, test } from 'bun:test'
import type { RankedPlayerQueries } from '@brawltome/player'
import { createPlayerRankedRouter } from '../src/router/player-ranked.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-ranked-test-secret'

function callerFor(rankedPlayerQueries: RankedPlayerQueries) {
  const context = { internalSecret: secret, rankedPlayerQueries } as Context
  return createPlayerRankedRouter(createInternalProcedure(secret)).createCaller(context)
}

describe('player.rankedById', () => {
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
              rating: 0,
              peakRating: 782,
              tier: 'Tin 0',
              wins: 0,
              games: 0,
              recordedAt: observedAt,
            },
            {
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
