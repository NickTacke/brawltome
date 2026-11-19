import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresAccounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { call, ORPCError } from '@orpc/server'
import { createReplayProcedures } from '../api/procedures'
import { replaysModule } from '../index'
import { claimJob, completeJob } from '../jobs'
import { uploadReplays } from '../upload'
import { insightLine } from './fixtures/insight-lines'
import { makeLine } from './fixtures/lines'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('replay procedures', () => {
  let database: TestDatabase
  let objectStore: ReturnType<typeof createMemoryObjectStore>
  let accounts: ReturnType<typeof createPostgresAccounts>['accounts']
  let procedures: ReturnType<typeof createReplayProcedures>
  let operatorAccountId: string
  let discordIds = 0
  let brawlhallaIds = 2000

  beforeAll(async () => {
    database = await createTestDatabase({
      label: 'replays_procedures',
      modules: [...accountsTestModules, replaysModule],
    })

    accounts = createPostgresAccounts(database).accounts
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(async () => {
    objectStore = createMemoryObjectStore()
    operatorAccountId = randomUUID()

    procedures = createReplayProcedures({
      database,
      objectStore,
      replayOperatorAccountIds: [operatorAccountId],
      replaysOpen: true,
    })
  })

  function visitor(sessionToken?: string) {
    return { context: { isInternalCaller: true, visitorSessionToken: sessionToken } }
  }

  async function signIn() {
    discordIds += 1

    return accounts.signInWithDiscord({
      providerAccountId: `replays-${discordIds}`,
      displayName: 'Ada',
      avatarHash: null,
    })
  }

  // what a finished Steam check leaves behind
  async function verify(accountId: string, brawlhallaId: number) {
    const attemptId = randomUUID()

    await database.sql`
      INSERT INTO accounts.primary_player_verification_attempts (id, account_id, proof_provider, proof_subject, idempotency_key, started_at)
      VALUES (${attemptId}, ${accountId}, 'steam', ${`steam-${attemptId}`}, ${attemptId}, clock_timestamp())
    `

    await database.sql`
      INSERT INTO accounts.primary_player_verification_outcomes
        (attempt_id, status, brawlhalla_id, player_name, evidence_source, evidence_checked_at, completed_at)
      VALUES (${attemptId}, 'verified', ${brawlhallaId}, 'Alpha', 'test', clock_timestamp(), clock_timestamp())
    `

    await database.sql`
      INSERT INTO accounts.primary_players (account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id)
      VALUES (${accountId}, ${brawlhallaId}, 'Alpha', clock_timestamp(), ${attemptId})
    `
  }

  function replayFile() {
    return new File([fakeReplay().bytes], '[11.00] Big Crystal Temple.replay')
  }

  async function parsedMatch(opponentId = 1002): Promise<string> {
    const { account, sessionToken } = await signIn()
    const brawlhallaId = ++brawlhallaIds

    await verify(account.id, brawlhallaId)
    await call(procedures.upload, { files: [replayFile()] }, visitor(sessionToken))

    const deps = { database, objectStore, artStore: null, accounts }
    const claimed = await claimJob(deps, { build: 'dev-1', patches: ['11.00'], artFormat: null })

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine({
        players: [
          { slot: 1, brawlhallaId, name: 'Alpha' },
          { slot: 2, brawlhallaId: opponentId, name: 'Bravo' },
        ],
      }),
    })

    const [match] = await database.sql<
      { id: string }[]
    >`SELECT id FROM replays.matches ORDER BY created_at DESC LIMIT 1`

    return match?.id as string
  }

  // an operator's upload of a real 1v1, which the match page reads
  async function insightMatch(): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    const deps = { database, objectStore, artStore: null, accounts }
    const files = [new File([new Uint8Array(fakeReplay().bytes)], 'a.replay')]
    const [upload] = await uploadReplays(deps, { accountId, isOperator: true, files })
    const claimed = await claimJob(deps, { build: 'dev-1', patches: ['11.00'], artFormat: null })

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: insightLine(),
    })

    const [match] = await database.sql<{ id: string }[]>`
      SELECT match_id AS id FROM replays.match_uploads WHERE upload_id = ${upload?.uploadId as string}
    `

    return match?.id as string
  }

  async function errorCode(work: Promise<unknown>): Promise<string> {
    const error = await work.then(() => null).catch((caught: unknown) => caught)

    return error instanceof ORPCError ? error.code : String(error)
  }

  test('upload needs a session', async () => {
    expect(await errorCode(call(procedures.upload, { files: [replayFile()] }, visitor()))).toBe('UNAUTHORIZED')
  })

  test('upload without a verified player is refused', async () => {
    const { sessionToken } = await signIn()

    expect(await errorCode(call(procedures.upload, { files: [replayFile()] }, visitor(sessionToken)))).toBe('FORBIDDEN')
  })

  test('a verified player and an operator may upload', async () => {
    const verified = await signIn()

    await verify(verified.account.id, ++brawlhallaIds)

    const result = await call(procedures.upload, { files: [replayFile()] }, visitor(verified.sessionToken))

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['queued'])

    const operator = await signIn()

    procedures = createReplayProcedures({
      database,
      objectStore,
      replayOperatorAccountIds: [operator.account.id],
      replaysOpen: true,
    })

    const operatorResult = await call(procedures.upload, { files: [replayFile()] }, visitor(operator.sessionToken))

    expect(operatorResult.outcomes[0]?.status).toBe('queued')
  })

  test('match answers NOT_FOUND for an unknown id', async () => {
    expect(await errorCode(call(procedures.match, { id: randomUUID() }, visitor()))).toBe('NOT_FOUND')
  })

  test('a parsed match is readable with its players, and listed under each player', async () => {
    const matchId = await parsedMatch()

    const match = await call(procedures.match, { id: matchId }, visitor())

    expect(match).toMatchObject({ id: matchId, mapName: 'Big Crystal Temple', isReliable: true })
    expect(match.players.map((player) => player.brawlhallaId)).toEqual([brawlhallaIds, 1002])
    expect(match.players.map((player) => player.score)).toEqual([null, null])
    expect(match.replay).toEqual({ available: true, patch: '11.00', fileName: '[11.00] BigCrystalTemple.replay' })

    const listed = await call(procedures.playerMatches, { brawlhallaId: 1002 }, visitor())

    expect(listed.matches.map((summary) => summary.id)).toContain(matchId)
  })

  test('recent matches list every parsed match, newest first, each with its result and no picture yet', async () => {
    const older = await parsedMatch()
    const newer = await parsedMatch()

    const recent = await call(procedures.recentMatches, {}, visitor())
    const ids = recent.matches.map((summary) => summary.id)

    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older))
    expect(recent.matches[0]?.mapPictureUrl).toBeNull()
    expect(recent.matches[0]?.players.some((player) => player.isWinner)).toBe(true)
  })

  test('the next page starts right after the last match, even one parsed microseconds before it', async () => {
    const later = await parsedMatch()
    const earlier = await parsedMatch()

    await database.sql`UPDATE replays.matches SET parsed_at = '2026-11-18 21:00:00.000500+00' WHERE id = ${later}`
    await database.sql`UPDATE replays.matches SET parsed_at = '2026-11-18 21:00:00.000497+00' WHERE id = ${earlier}`

    const micros = String(Date.parse('2026-11-18T21:00:00.000Z') * 1000 + 500)
    const cursor = Buffer.from(`${micros}|${later}`).toString('base64url')

    const next = await call(procedures.recentMatches, { cursor }, visitor())
    const ids = next.matches.map((summary) => summary.id)

    expect(ids).toContain(earlier)
    expect(ids).not.toContain(later)
  })

  test('your matches are the ones your verified player played in, whoever uploaded them', async () => {
    const { account, sessionToken } = await signIn()
    const yourId = ++brawlhallaIds

    await verify(account.id, yourId)

    const matchId = await parsedMatch(yourId)

    await parsedMatch()

    const mine = await call(procedures.myMatches, {}, visitor(sessionToken))

    expect(mine.player).toEqual({ brawlhallaId: yourId, name: 'Alpha' })
    expect(mine.matches.map((summary) => summary.id)).toEqual([matchId])
    expect(mine.record?.games).toBe(1)
    expect(mine.record?.legends).toHaveLength(1)
  })

  test('a visitor without a verified player has no matches', async () => {
    const { sessionToken } = await signIn()

    const mine = await call(procedures.myMatches, {}, visitor(sessionToken))

    expect(mine).toEqual({
      player: null,
      record: { games: 0, wins: 0, lastParsedAt: null, legends: [] },
      matches: [],
      nextCursor: null,
    })
  })

  test('your matches need you to be signed in', async () => {
    expect(await errorCode(call(procedures.myMatches, {}, visitor()))).toBe('UNAUTHORIZED')
  })

  test('a malformed cursor starts from the first page instead of failing', async () => {
    const matchId = await parsedMatch()

    const badCursors = [
      `2026-11-14T00:00:00.000Z|${'-'.repeat(36)}`,
      '2026-11-14T00:00:00.000Z|zzzz',
      'not a date|00000000-0000-0000-0000-000000000000',
    ].map((raw) => Buffer.from(raw).toString('base64url'))

    for (const cursor of badCursors) {
      const listed = await call(procedures.playerMatches, { brawlhallaId: 1002, cursor }, visitor())

      expect(listed.matches.map((summary) => summary.id)).toContain(matchId)
    }
  })

  test('replayFile gives the bytes back, then GONE once the file is deleted', async () => {
    const matchId = await parsedMatch()

    const file = await call(procedures.replayFile, { id: matchId }, visitor())

    expect(file.name).toBe('[11.00] BigCrystalTemple.replay')
    expect(new Uint8Array(await file.arrayBuffer())[0]).toBe(0x78)

    await database.sql`
      UPDATE replays.replay_files SET deleted_at = clock_timestamp()
      WHERE digest = (SELECT digest FROM replays.matches WHERE id = ${matchId})
    `

    expect(await errorCode(call(procedures.replayFile, { id: matchId }, visitor()))).toBe('GONE')
  })

  test('playback gives the trimmed timeline, gzipped, and says whether replays are open', async () => {
    const matchId = await insightMatch()

    const match = await call(procedures.match, { id: matchId }, visitor())

    expect(match.playbackPath).toBe(`/match/${matchId}/playback/dev-1/1`)
    expect(match.art).toEqual({ state: 'none', manifestUrl: null, baseUrl: null })

    const playback = await call(procedures.playback, { id: matchId, build: 'dev-1', version: 1 }, visitor())
    const timeline = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await playback.body.bytes())))

    expect(playback.headers).toEqual({ 'x-replays-open': 'true' })
    expect(timeline).toMatchObject({ stepMs: 16, startStep: 375 })
    expect(timeline).not.toHaveProperty('events')
  })

  test('playback answers NOT_FOUND for a build the match was not parsed with', async () => {
    const matchId = await insightMatch()

    const input = { id: matchId, build: 'dev-0', version: 1 }

    expect(await errorCode(call(procedures.playback, input, visitor()))).toBe('NOT_FOUND')
  })

  test('a playback timeline trimmed by an older version is neither served nor asked for', async () => {
    const matchId = await insightMatch()
    const stale = Bun.gzipSync(new TextEncoder().encode('{"stale":true}'))

    await objectStore.put(`playback/${matchId}/dev-1.json.gz`, stale, 'application/gzip')
    await objectStore.put(`playback/${matchId}/dev-1/0.json.gz`, stale, 'application/gzip')

    const playback = await call(procedures.playback, { id: matchId, build: 'dev-1', version: 1 }, visitor())
    const timeline = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await playback.body.bytes())))

    expect(timeline).toMatchObject({ stepMs: 16 })
    expect(objectStore.keys()).toContain(`playback/${matchId}/dev-1/1.json.gz`)

    const olderInput = { id: matchId, build: 'dev-1', version: 0 }

    expect(await errorCode(call(procedures.playback, olderInput, visitor()))).toBe('NOT_FOUND')
  })

  test('mine lists the visitor’s uploads with their state', async () => {
    const { account, sessionToken } = await signIn()

    await verify(account.id, ++brawlhallaIds)
    await call(procedures.upload, { files: [replayFile()] }, visitor(sessionToken))

    const mine = await call(procedures.mine, undefined, visitor(sessionToken))

    expect(mine.replays).toHaveLength(1)
    expect(mine.replays[0]).toMatchObject({ status: 'waiting', rejection: null, matchId: null })
  })

  test('while replays are closed, only operators see them, and access says so', async () => {
    const matchId = await parsedMatch()
    const operator = await signIn()
    const visitorSession = (await signIn()).sessionToken

    const closed = createReplayProcedures({
      database,
      objectStore,
      replayOperatorAccountIds: [operator.account.id],
      replaysOpen: false,
    })

    expect(await call(closed.access, undefined, visitor(visitorSession))).toEqual({
      isOpen: false,
      canSee: false,
      canUpload: false,
    })

    // the operator has no Steam link here, and may upload all the same
    expect(await call(closed.access, undefined, visitor(operator.sessionToken))).toEqual({
      isOpen: false,
      canSee: true,
      canUpload: true,
    })

    expect(await errorCode(call(closed.match, { id: matchId }, visitor(visitorSession)))).toBe('NOT_FOUND')

    const playable = { id: await insightMatch(), build: 'dev-1', version: 1 }

    expect(await errorCode(call(closed.playback, playable, visitor(visitorSession)))).toBe('NOT_FOUND')

    expect((await call(closed.playback, playable, visitor(operator.sessionToken))).headers).toEqual({
      'x-replays-open': 'false',
    })

    expect(await errorCode(call(closed.playerMatches, { brawlhallaId: 1002 }, visitor()))).toBe('NOT_FOUND')
    expect(await errorCode(call(closed.mine, undefined, visitor(visitorSession)))).toBe('FORBIDDEN')
    expect((await call(closed.match, { id: matchId }, visitor(operator.sessionToken))).id).toBe(matchId)
  })

  test('access says who may upload: verified players and operators, not other visitors', async () => {
    const verified = await signIn()
    const unverified = await signIn()
    const operator = await signIn()

    brawlhallaIds += 1
    await verify(verified.account.id, brawlhallaIds)

    const open = createReplayProcedures({
      database,
      objectStore,
      replayOperatorAccountIds: [operator.account.id],
      replaysOpen: true,
    })

    const canUpload = async (sessionToken?: string) =>
      (await call(open.access, undefined, visitor(sessionToken))).canUpload

    expect(await canUpload(verified.sessionToken)).toBe(true)
    expect(await canUpload(operator.sessionToken)).toBe(true)
    expect(await canUpload(unverified.sessionToken)).toBe(false)
    expect(await canUpload()).toBe(false)
  })
})
