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

describe('ranking recent activity over oRPC', () => {
  test('serves a page of the last hour from the path and query', async () => {
    expect(await getBoard('3v3/EU/recent-activity?page=2')).toEqual({
      status: 200,
      body: { status: 'unavailable', reason: 'not_enough_history', mode: '3v3', region: 'EU', page: 2, pageSize: 30 },
    })
  })

  test('serves the movers from the path', async () => {
    expect(await getBoard('2v2/all/recent-movers')).toEqual({
      status: 200,
      body: { status: 'unavailable', reason: 'not_enough_history', mode: '2v2', region: 'all' },
    })
  })

  test('rejects an unknown bracket with a 400', async () => {
    expect((await getBoard('5v5/EU/recent-movers')).status).toBe(400)
  })

  test('refuses a caller without the secret with 403', async () => {
    expect((await getBoard('1v1/EU/recent-movers', {})).status).toBe(403)
  })

  test('is listed in the OpenAPI document with the internal secret', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown }>>
    }

    const page = document.paths['/leaderboards/{mode}/{region}/recent-activity'].get
    const movers = document.paths['/leaderboards/{mode}/{region}/recent-movers'].get

    expect([page.operationId, movers.operationId]).toEqual([
      'ranking.recentActivityPage',
      'ranking.recentActivityMovers',
    ])

    expect([page.security, movers.security]).toEqual([[{ internalSecret: [] }], [{ internalSecret: [] }]])
  })
})
