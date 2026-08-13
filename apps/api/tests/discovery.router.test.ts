import { describe, expect, test } from 'bun:test'
import { createSearchRouter } from '../src/router/search.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'discovery-router-test-secret'

describe('canonical Discovery router', () => {
  test('serves both entity kinds through one raw Discovery query', async () => {
    const calls: string[] = []
    const context = {
      internalSecret: secret,
      discoveryQueries: {
        search: async (query: string) => {
          calls.push(query)
          return {
            players: [
              {
                brawlhallaId: 42,
                name: 'Canonical',
                region: null,
                rating: null,
                viewCount: 7,
                bestLegendNameKey: null,
                matchedAlias: 'Former',
              },
            ],
            clans: [{ clanId: 42, clanName: 'Clan', clanXp: '100', memberCount: 2 }],
          }
        },
      },
    } as unknown as Context
    const caller = createSearchRouter(createInternalProcedure(secret)).createCaller(context)

    await expect(caller.local({ query: '  PLAYER  ' })).resolves.toEqual({
      players: [expect.objectContaining({ brawlhallaId: 42, rating: null, matchedAlias: 'Former' })],
      clans: [{ clanId: 42, clanName: 'Clan', clanXp: '100', memberCount: 2 }],
    })
    expect(calls).toEqual(['  PLAYER  '])
  })
})
