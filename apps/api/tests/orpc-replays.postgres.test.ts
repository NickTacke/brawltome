import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createPostgresAccounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createReplayJobs, replaysModule } from '@brawltome/replays'
import { createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'

const secret = 'orpc-replays-test-secret'
const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('replays over /v1', () => {
  let database: TestDatabase
  let app: Hono
  let sessionToken: string
  const objectStore = createMemoryObjectStore()

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'orpc_replays', modules: [...accountsTestModules, replaysModule] })

    const { accounts } = createPostgresAccounts(database)

    const signIn = await accounts.signInWithDiscord({
      providerAccountId: 'orpc-replays',
      displayName: 'Ada',
      avatarHash: null,
    })

    sessionToken = signIn.sessionToken

    // the operator may upload any replay, so the test needs no Steam check
    const runtime = { database, objectStore, replayOperatorAccountIds: [signIn.account.id] }
    const router = createOrpcRouter([...accountsTestModules, replaysModule], runtime)

    app = new Hono()

    app.route(
      '/',
      createOrpcRoutes({
        telemetry: createTelemetry({ service: 'api', drainIntervalMs: 0 }),
        router,
        internalSecret: secret,
      }),
    )
  }, 30_000)

  afterAll(async () => {
    await database?.drop()
  })

  function siteHeaders(): Record<string, string> {
    return { 'x-internal-secret': secret, 'x-visitor-session': sessionToken }
  }

  function replayBytes(): Uint8Array<ArrayBuffer> {
    const bytes = crypto.getRandomValues(new Uint8Array(40))

    bytes[0] = 0x78
    bytes[1] = 0xda

    return bytes
  }

  test('a multipart upload queues the file', async () => {
    const form = new FormData()

    form.append('files[0]', new File([replayBytes()], '[11.00] BigCrystalTemple.replay'))

    const response = await app.fetch(
      new Request('http://api.test/v1/replays', { method: 'POST', headers: siteHeaders(), body: form }),
    )

    const body = (await response.json()) as { outcomes: { status: string; fileName: string }[] }

    expect(response.status).toBe(200)

    expect(body.outcomes).toEqual([
      expect.objectContaining({ status: 'queued', fileName: '[11.00] BigCrystalTemple.replay' }),
    ])
  })

  test('the replay file downloads with its name', async () => {
    const bytes = replayBytes()
    const form = new FormData()

    form.append('files[0]', new File([bytes], 'x.replay'))
    await app.fetch(new Request('http://api.test/v1/replays', { method: 'POST', headers: siteHeaders(), body: form }))

    const jobs = createReplayJobs({ database, objectStore, accounts: createPostgresAccounts(database).accounts })

    // finish every queued job with a made-up line, so a match exists
    for (
      let claimed = await jobs.claim({ build: 'dev-1', patches: ['11.00'] });
      claimed;
      claimed = await jobs.claim({ build: 'dev-1', patches: ['11.00'] })
    ) {
      await jobs.complete({ jobId: claimed.jobId, leaseToken: claimed.leaseToken, line: madeUpLine() })
    }

    const [match] = await database.sql<
      { id: string }[]
    >`SELECT id FROM replays.matches ORDER BY created_at DESC LIMIT 1`

    const response = await app.fetch(
      new Request(`http://api.test/v1/matches/${match?.id}/replay`, { headers: siteHeaders() }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('[11.00] BigCrystalTemple.replay')
    expect((await response.arrayBuffer()).byteLength).toBe(40)
  })

  test('the OpenAPI document lists the replay paths', async () => {
    const response = await app.fetch(new Request('http://api.test/openapi.json'))
    const document = (await response.json()) as { paths: Record<string, unknown> }

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/replays',
        '/matches/{id}',
        '/players/{brawlhallaId}/matches',
        '/matches/{id}/replay',
        '/me/replays',
      ]),
    )
  })
})

function madeUpLine(): string {
  const player = (slot: number, brawlhallaId: number) => ({
    BrawlhallaID: brawlhallaId,
    PlayerName: `Player ${slot}`,
    DamageDealt: 100,
    DamageTaken: 90,
    TotalDodges: 1,
    AirDodges: 0,
    Dashes: 2,
    DashJumps: 0,
    TotalJumps: 3,
    AirJumps: 1,
    TimeInAir: 1000,
    TimeOnGround: 2000,
    TimeOnWall: 0,
    KOs: 1,
    Deaths: 1,
    Suicides: 0,
    Clashes: 0,
    Score: 10,
  })

  return JSON.stringify({
    exit: 0,
    patch: '11.00',
    format: 1,
    stats: { GameDuration: 60000, Player1: player(1, 3001), Player2: player(2, 3002) },
    match: {
      map: { id: 136, name: 'Big Crystal Temple' },
      rules: {
        mode: { id: 2, name: 'Stock' },
        queue: 'ranked',
        isRanked: true,
        isCustom: false,
        hasTeams: false,
        hasTeamDamage: false,
        stocks: 3,
      },
      players: [
        { slot: 1, brawlhallaId: 3001, name: 'Player 1', team: 0, legend: { id: 1, name: 'BODVAR' } },
        { slot: 2, brawlhallaId: 3002, name: 'Player 2', team: 0, legend: { id: 2, name: 'CASSIDY' } },
      ],
    },
    timeline: { events: [] },
    reliability: { isReliable: true, checks: [], unchecked: [] },
  })
}
