import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createDiscoveryProcedures } from '../api/procedures'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'discovery_search_procedure', modules: [queueModule, discoveryModule] })

  const discovery = createPostgresDiscovery(database)

  await discovery.rebuildPlayers({
    sourceVersion: 1,
    facts: [
      {
        brawlhallaId: 301,
        name: 'Renamed',
        region: 'EU',
        rating: 2100,
        viewCount: 7,
        bestLegendNameKey: 'bodvar',
        aliases: ['Comet'],
      },
      {
        brawlhallaId: 302,
        name: 'Comet Two',
        region: 'US-E',
        rating: 1500,
        viewCount: 3,
        bestLegendNameKey: null,
        aliases: [],
      },
    ],
  })

  await discovery.rebuildClans({
    sourceVersion: 1,
    facts: [{ clanId: 401, clanName: 'Comet Guild', clanXp: '900719925474099312345', memberCount: 12 }],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('discovery.search', () => {
  test('returns the players and guilds the search panel shows, current names first', async () => {
    const { search } = createDiscoveryProcedures({ database })

    expect(await call(search, { query: 'comet' }, internalCaller)).toEqual({
      players: [
        {
          brawlhallaId: 302,
          name: 'Comet Two',
          region: 'US-E',
          rating: 1500,
          viewCount: 3,
          bestLegendNameKey: null,
          matchedAlias: null,
        },
        {
          brawlhallaId: 301,
          name: 'Renamed',
          region: 'EU',
          rating: 2100,
          viewCount: 7,
          bestLegendNameKey: 'bodvar',
          matchedAlias: 'Comet',
        },
      ],
      clans: [{ clanId: 401, clanName: 'Comet Guild', clanXp: '900719925474099312345', memberCount: 12 }],
    })
  })

  test('rejects callers from outside', async () => {
    const { search } = createDiscoveryProcedures({ database })

    await expect(call(search, { query: 'comet' }, outsideCaller)).rejects.toThrow()
  })

  test('is served under the discovery module', () => {
    expect(discoveryModule.name).toBe('discovery')
    expect(Object.keys(discoveryModule.routes({ database }))).toEqual(['search'])
  })
})
