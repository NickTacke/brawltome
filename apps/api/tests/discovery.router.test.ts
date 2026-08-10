import { describe, expect, test } from 'bun:test'
import { createSearchRouter } from '../src/router/search.router'
import type { Context } from '../src/trpc/context'
import { createInternalProcedure } from '../src/trpc/trpc'

const secret = 'discovery-router-test-secret'

describe('canonical Discovery router', () => {
  test('serves Players through Discovery while preserving the combined route contract', async () => {
    const calls: string[] = []
    const context = {
      internalSecret: secret,
      discoveryQueries: {
        searchPlayers: async (query: string) => {
          calls.push(query)
          return [
            {
              brawlhallaId: 42,
              name: 'Canonical',
              region: null,
              rating: null,
              viewCount: 7,
              bestLegendNameKey: null,
              matchedAlias: 'Former',
            },
          ]
        },
      },
      clanRepo: {
        searchClans: async () => [{ clanId: 9, clanName: 'Clan', clanXp: '100', memberCount: 2 }],
      },
    } as unknown as Context
    const caller = createSearchRouter(createInternalProcedure(secret)).createCaller(context)

    await expect(caller.local({ query: '  PLAYER  ' })).resolves.toEqual({
      players: [expect.objectContaining({ brawlhallaId: 42, rating: null, matchedAlias: 'Former' })],
      clans: [{ clanId: 9, clanName: 'Clan', clanXp: '100', memberCount: 2 }],
    })
    expect(calls).toEqual(['player'])
  })
})
