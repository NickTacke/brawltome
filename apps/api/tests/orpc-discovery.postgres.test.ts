import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-discovery-test-secret'
const internalHeaders = { 'x-internal-secret': secret }

let database: TestDatabase
let app: Hono

async function fetchSearch(query: string, headers: Record<string, string> = internalHeaders) {
  const response = await app.fetch(
    new Request(`http://api.test/v1/search?query=${encodeURIComponent(query)}`, { headers }),
  )

  return { status: response.status, body: await response.json() }
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'orpc_discovery', modules: [queueModule, discoveryModule] })

  await createPostgresDiscovery(database).rebuildPlayers({
    sourceVersion: 1,
    facts: [
      {
        brawlhallaId: 42,
        name: 'Orbit Runner',
        region: 'EU',
        rating: 1800,
        viewCount: 0,
        bestLegendNameKey: 'asuri',
        aliases: [],
      },
    ],
  })

  const router = createOrpcRouter([discoveryModule], { database })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('discovery.search over oRPC', () => {
  test('serves results at GET /v1/search', async () => {
    expect(await fetchSearch('orbit run')).toEqual({
      status: 200,
      body: {
        players: [
          {
            brawlhallaId: 42,
            name: 'Orbit Runner',
            region: 'EU',
            rating: 1800,
            viewCount: 0,
            bestLegendNameKey: 'asuri',
            matchedAlias: null,
          },
        ],
        clans: [],
      },
    })
  })

  test('rejects a query over 100 characters with a 400', async () => {
    expect((await fetchSearch('a'.repeat(101))).status).toBe(400)
  })

  test('refuses a caller without the secret with 403', async () => {
    expect(await fetchSearch('orbit', {})).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
  })
})
