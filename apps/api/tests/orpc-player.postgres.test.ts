import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-player-test-secret'
const internalHeaders = { 'x-internal-secret': secret }
const rankedPlayerId = 42
const checkedAt = '2026-11-01T12:30:00.000Z'

const refusedCallers: { caller: string; headers: Record<string, string> }[] = [
  { caller: 'no secret', headers: {} },
  { caller: 'a wrong secret', headers: { 'x-internal-secret': `${secret}-wrong` } },
]

let database: TestDatabase
let app: Hono

async function postRankedSummaries(body: unknown, headers: Record<string, string> = internalHeaders) {
  const response = await app.fetch(
    new Request('http://api.test/v1/players/ranked-summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )

  return { status: response.status, body: await response.json() }
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'orpc_player', modules: [queueModule, playerModule] })

  await database.sql`
    INSERT INTO players.ranked_profiles (
      brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games
    )
    VALUES (${rankedPlayerId}, 'Ranked', ${checkedAt}, ${checkedAt}, 'EU', 1800, 1850, 'Platinum 1', 12, 20)
  `

  const router = createOrpcRouter([playerModule], { database })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('player.rankedSummaries over oRPC', () => {
  test('serves the summaries at POST /v1/players/ranked-summaries', async () => {
    expect(await postRankedSummaries({ ids: [rankedPlayerId] })).toEqual({
      status: 200,
      body: [
        {
          brawlhallaId: rankedPlayerId,
          rating: 1800,
          wins: 12,
          games: 20,
          mainLegend: null,
          updatedAt: checkedAt,
        },
      ],
    })
  })

  test('rejects more than 250 ids with a 400', async () => {
    const ids = Array.from({ length: 251 }, (_, index) => index + 1)

    expect((await postRankedSummaries({ ids })).status).toBe(400)
  })

  for (const { caller, headers } of refusedCallers) {
    test(`refuses ${caller} with 403`, async () => {
      expect(await postRankedSummaries({ ids: [rankedPlayerId] }, headers)).toMatchObject({
        status: 403,
        body: { code: 'FORBIDDEN' },
      })
    })
  }

  test('is listed in the OpenAPI document with the internal secret', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown }>>
    }

    expect(Object.keys(document.paths).sort()).toEqual([
      '/legends/meta',
      '/legends/most-played',
      '/players/ranked-summaries',
      '/players/{id}/career',
      '/players/{id}/ranked',
      '/players/{id}/reference',
      '/seasons',
      '/status',
    ])

    expect(document.paths['/players/ranked-summaries'].post.operationId).toBe('player.rankedSummaries')
    expect(document.paths['/players/ranked-summaries'].post.security).toEqual([{ internalSecret: [] }])
  })
})
