import { describe, expect, test } from 'bun:test'
import type { CareerPlayerQueries } from '@brawltome/player'
import { createPlayerCareerRouter } from '../src/router/player-career.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'player-career-test-secret'

function callerFor(careerPlayerQueries: CareerPlayerQueries) {
  const context = { internalSecret: secret, careerPlayerQueries } as Context
  return createPlayerCareerRouter(createInternalProcedure(secret)).createCaller(context)
}

describe('player.careerById', () => {
  test('maps dates and exact damage into canonical output and rejects malformed producer values', async () => {
    const observedAt = new Date('2026-08-09T22:00:00Z')
    const caller = callerFor({
      byId: async (brawlhallaId) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: observedAt,
        freshness: 'fresh',
        freshForSeconds: 43_200,
        snapshot: {
          account: { xp: 0, level: 0, xpPercentage: 0 },
          combat: {
            games: 0,
            wins: 0,
            matchTime: 0,
            damageBomb: '9007199254740993',
            damageMine: '0',
            damageSpikeball: '0',
            damageSidekick: '0',
            snowballHits: 0,
            bombKos: 0,
            mineKos: 0,
            spikeballKos: 0,
            sidekickKos: 0,
            snowballKos: 0,
          },
          legends: [],
          weapons: [],
        },
      }),
    })

    await expect(caller.careerById({ id: 42 })).resolves.toMatchObject({
      checkedAt: '2026-08-09T22:00:00.000Z',
      lastSuccessAt: '2026-08-09T22:00:00.000Z',
      freshForSeconds: 43_200,
      snapshot: { combat: { games: 0, damageBomb: '9007199254740993' }, legends: [], weapons: [] },
    })
    await expect(caller.careerById({ id: 0 })).rejects.toThrow()

    const malformed = {
      byId: async (brawlhallaId: number) => ({
        brawlhallaId,
        checkedAt: observedAt,
        lastSuccessAt: null,
        freshness: 'unavailable',
        freshForSeconds: 3600,
        snapshot: null,
      }),
    } as unknown as CareerPlayerQueries
    await expect(callerFor(malformed).careerById({ id: 42 })).rejects.toThrow()
  })
})
