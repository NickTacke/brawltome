import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresAccounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { call, ORPCError } from '@orpc/server'
import { createReplayProcedures } from '../api/procedures'
import { replaysModule } from '../index'
import { claimJob, completeJob } from '../jobs'
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

  async function parsedMatch(): Promise<string> {
    const { account, sessionToken } = await signIn()
    const brawlhallaId = ++brawlhallaIds

    await verify(account.id, brawlhallaId)
    await call(procedures.upload, { files: [replayFile()] }, visitor(sessionToken))

    const deps = { database, objectStore, accounts }
    const claimed = await claimJob(deps, { build: 'dev-1', patches: ['11.00'] })

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine({
        players: [
          { slot: 1, brawlhallaId, name: 'Alpha' },
          { slot: 2, brawlhallaId: 1002, name: 'Bravo' },
        ],
      }),
    })

    const [match] = await database.sql<
      { id: string }[]
    >`SELECT id FROM replays.matches ORDER BY created_at DESC LIMIT 1`

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
    expect(match.replay).toEqual({ available: true, patch: '11.00', fileName: '[11.00] BigCrystalTemple.replay' })

    const listed = await call(procedures.playerMatches, { brawlhallaId: 1002 }, visitor())

    expect(listed.matches.map((summary) => summary.id)).toContain(matchId)
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
