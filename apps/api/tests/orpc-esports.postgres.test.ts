import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { esportsModule } from '@brawltome/esports'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-esports-test-secret'
const internalHeaders = { 'x-internal-secret': secret }

// 81 has a trusted record with one finish, 82 is unknown to brawltools, 83 was never asked about
const linkedId = 81
const noneId = 82
const neverCheckedId = 83

let database: TestDatabase
let app: Hono

async function getEsports(id: string, headers: Record<string, string> = internalHeaders) {
  const response = await app.fetch(new Request(`http://api.test/v1/players/${id}/esports`, { headers }))

  return { status: response.status, body: await response.json() }
}

async function storePlayers() {
  const sql = database.sql
  const checkedAt = new Date()

  const powerRanking = {
    earnings: 250,
    pr: { top8: 2, top32: 4, gold: 1, silver: 0, bronze: 1, powerRanking: 9, region: 'EU' },
  }

  await sql`
    INSERT INTO esports.players
      (brawlhalla_id, brawltools_player_id, brawltools_name, link, pr_1v1, event_legends, checked_at, last_success_at,
       failure_count)
    VALUES
      (${linkedId}, 501, 'Ember', 'linked', ${sql.json(powerRanking)}, ${sql.json([])}, ${checkedAt}, ${checkedAt}, 0),
      (${noneId}, NULL, NULL, 'none', NULL, ${sql.json([])}, ${checkedAt}, ${checkedAt}, 0)
  `

  await sql`
    INSERT INTO esports.placements
      (brawlhalla_id, mode, tournament_id, tournament_name, is_official, is_online, start_time, placement)
    VALUES (${linkedId}, 1, 'frostbyte-19/1v1', 'Frostbyte #19', false, true, '2026-03-14T18:00:00Z', 2)
  `

  await sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${linkedId}, 'Ember', ${checkedAt}, ${checkedAt}, 'EU', 2000, 2100, 'Diamond', 1, 2)
  `
}

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'orpc_esports',
    modules: [queueModule, playerModule, esportsModule],
  })

  await storePlayers()

  const router = createOrpcRouter([esportsModule], { database })
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })

  app = new Hono()
  app.route('/', createOrpcRoutes({ telemetry, router, internalSecret: secret }))
}, 30_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('esports.byPlayerId over oRPC', () => {
  test('answers with the profile of a trusted record', async () => {
    const { status, body } = await getEsports(String(linkedId))

    expect(status).toBe(200)

    expect(body).toMatchObject({
      freshness: 'fresh',
      profile: {
        earnings: 250,
        rankings: [{ mode: '1v1', rank: 9, region: 'EU' }],
        results: [{ fullName: 'Frostbyte #19', placement: 2, sets: [], setRecord: null }],
      },
    })
  })

  test('answers with no profile for a player brawltools does not know, or one never asked about', async () => {
    expect(await getEsports(String(noneId))).toEqual({ status: 200, body: { profile: null, freshness: 'fresh' } })

    expect(await getEsports(String(neverCheckedId))).toEqual({
      status: 200,
      body: { profile: null, freshness: 'missing' },
    })
  })

  test.each(['0', 'abc', '2147483648'])('rejects %s as a player id with a 400', async (id) => {
    expect((await getEsports(id)).status).toBe(400)
  })

  test('refuses a caller without the secret with 403', async () => {
    expect((await getEsports(String(linkedId), {})).status).toBe(403)
  })

  test('is listed in the OpenAPI document with the internal secret', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))

    const document = (await response.json()) as {
      paths: Record<string, Record<string, { operationId?: string; security?: unknown }>>
    }

    const operation = document.paths['/players/{id}/esports'].get

    expect(operation.operationId).toBe('esports.byPlayerId')
    expect(operation.security).toEqual([{ internalSecret: [] }])
  })
})
