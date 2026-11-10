import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
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

async function getBoardRanks(path: string, headers: Record<string, string> = internalHeaders) {
  const response = await app.fetch(new Request(`http://api.test/v1/players/${path}`, { headers }))

  return { status: response.status, body: await response.json() }
}

function boardRow(snapshotId: string, rank: number, playerId: number) {
  return {
    snapshot_id: snapshotId,
    mode: '1v1',
    ordinal: rank,
    standing: rank,
    source_rank: rank,
    identity_kind: 'one-vs-one-player',
    player_one_id: playerId,
    player_one_name: `Captured ${playerId}`,
    region: 'SEA',
    rating: 2_500 - rank,
    peak_rating: 2_600,
    wins: 40,
    losses: 10,
    tier: 'Diamond',
  }
}

// the only boards in this file with rows: player 72 is second in the world and first in SEA
async function publishOneVsOneBoards() {
  const generationId = randomUUID()
  const observedAt = new Date('2026-11-09T12:00:00.000Z')
  const nextPublicationAt = new Date('2026-11-09T12:15:00.000Z')
  const provenance = { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 }
  const boards = { all: [71, 72], SEA: [72] }
  const sql = database.sql

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES (${generationId}, ${randomUUID()}, 'orpc-ranking-test', '1v1', ${observedAt}, ${observedAt},
      ${nextPublicationAt}, 1, 'brawlhalla-v1-ranked-leaderboard', 2, false, ${sql.json(provenance)})
  `

  for (const [scope, playerIds] of Object.entries(boards)) {
    const snapshotId = randomUUID()
    const rows = playerIds.map((playerId, index) => boardRow(snapshotId, index + 1, playerId))

    await sql`
      INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
      VALUES (${snapshotId}, ${generationId}, '1v1', ${scope}, ${rows.length})
    `

    await sql`INSERT INTO rankings.snapshot_rows ${sql(rows)}`
  }

  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'orpc_ranking',
    modules: [queueModule, playerModule, rankingModule],
  })

  await publishOneVsOneBoards()

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

describe('ranking.boardRanksById over oRPC', () => {
  test('takes the player from the path and the region from the query', async () => {
    expect(await getBoardRanks('72/board-ranks?region=SEA')).toEqual({
      status: 200,
      body: { globalRank: 2, regionRank: 1 },
    })
  })

  test('answers with the global rank alone when no region is given', async () => {
    expect(await getBoardRanks('72/board-ranks')).toEqual({ status: 200, body: { globalRank: 2, regionRank: null } })
  })

  test('answers with no ranks for a player on no board', async () => {
    expect(await getBoardRanks('73/board-ranks?region=SEA')).toEqual({
      status: 200,
      body: { globalRank: null, regionRank: null },
    })
  })

  test.each(['MOON', 'all'])('rejects %s as a region with a 400', async (region) => {
    expect((await getBoardRanks(`72/board-ranks?region=${region}`)).status).toBe(400)
  })

  test('refuses a caller without the secret with 403', async () => {
    expect((await getBoardRanks('72/board-ranks?region=SEA', {})).status).toBe(403)
  })

  test('is listed in the OpenAPI document with the internal secret', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown }>>
    }

    const operation = document.paths['/players/{id}/board-ranks'].get

    expect(operation.operationId).toBe('ranking.boardRanksById')
    expect(operation.security).toEqual([{ internalSecret: [] }])
  })
})
