import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { rankingModule } from '@brawltome/ranking'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-ranking-test-secret'
const internalHeaders = { 'x-internal-secret': secret }

let database: TestDatabase
let app: Hono

async function getBoard(path: string, headers: Record<string, string> = internalHeaders) {
  const response = await app.fetch(new Request(`http://api.test/v1/leaderboards/${path}`, { headers }))

  return { status: response.status, body: await response.json() }
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'orpc_ranking',
    modules: [queueModule, playerModule, rankingModule],
  })

  const router = createOrpcRouter([rankingModule], { database })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('ranking.leaderboardPage over oRPC', () => {
  test('takes the bracket and region from the path and the page from the query', async () => {
    expect(await getBoard('solo2v2/US-E?page=3')).toEqual({
      status: 200,
      body: { status: 'unavailable', reason: 'not_yet_published', mode: 'solo2v2', page: 3, pageSize: 30 },
    })
  })

  test('rejects an unknown region with a 400', async () => {
    expect((await getBoard('1v1/MOON?page=1')).status).toBe(400)
  })

  test('refuses a caller without the secret with 403', async () => {
    expect(await getBoard('1v1/EU?page=1', {})).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
  })

  test('is listed in the OpenAPI document with the internal secret', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown }>>
    }

    const operation = document.paths['/leaderboards/{mode}/{region}'].get

    expect(operation.operationId).toBe('ranking.leaderboardPage')
    expect(operation.security).toEqual([{ internalSecret: [] }])
  })
})
