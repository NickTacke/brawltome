import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { replaysModule } from '../index'
import { claimJob, completeJob, failJob, releaseJob, renewLease } from '../jobs'
import type { ReplaysDeps } from '../model'
import { uploadReplays } from '../upload'
import { makeLine } from './fixtures/lines'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL
const report = { build: 'dev-1', patches: ['11.00'] }

describe.skipIf(!connectionString)('replay jobs', () => {
  let database: TestDatabase
  let deps: ReplaysDeps & { objectStore: ReturnType<typeof createMemoryObjectStore> }
  const primaryPlayers = new Map<string, number>()

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_jobs', modules: [...accountsTestModules, replaysModule] })
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(async () => {
    // each test starts with an empty queue, so "the next job" is always one this test made
    await database.sql`TRUNCATE replays.jobs, replays.match_uploads, replays.match_players, replays.matches, replays.uploads, replays.replay_files`

    const accounts = {
      getPrimaryPlayerVerificationState: async (accountId: string) => {
        const brawlhallaId = primaryPlayers.get(accountId)

        return {
          primaryPlayer: brawlhallaId ? { brawlhallaId, name: null, verifiedAt: new Date() } : null,
          attempts: [],
        }
      },
    } as unknown as Accounts

    deps = { database, objectStore: createMemoryObjectStore(), accounts }
  })

  async function playerAccount(brawlhallaId: number | null): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`
    if (brawlhallaId) primaryPlayers.set(accountId, brawlhallaId)

    return accountId
  }

  async function uploadAs(accountId: string, bytes = fakeReplay().bytes, isOperator = false) {
    const [outcome] = await uploadReplays(deps, {
      accountId,
      isOperator,
      files: [new File([new Uint8Array(bytes)], 'a.replay')],
    })

    return outcome
  }

  async function uploadStatus(uploadId: string | null) {
    const [row] = await database.sql<{ status: string; code: string | null }[]>`
      SELECT status, rejection->>'code' AS code FROM replays.uploads WHERE id = ${uploadId as string}
    `

    return row
  }

  async function expireLease(jobId: string) {
    await database.sql`
      UPDATE replays.jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${jobId}
    `
  }

  test('claims the oldest parse job before any reparse job', async () => {
    const first = fakeReplay()

    await database.sql`INSERT INTO replays.replay_files (digest, byte_size) VALUES (${first.digest}, 64)`
    await database.sql`INSERT INTO replays.jobs (digest, kind) VALUES (${first.digest}, 'reparse')`
    await deps.objectStore.put(`replays/${first.hex}.replay`, first.bytes, 'application/octet-stream')
    await uploadAs(await playerAccount(1001))

    const claimed = await claimJob(deps, report)

    expect(claimed?.kind).toBe('parse')
    expect(claimed?.replayBytes[0]).toBe(0x78)
  })

  test('a completed parse creates one match with its players and a timeline object', async () => {
    const outcome = await uploadAs(await playerAccount(1001))
    const claimed = await claimJob(deps, report)

    const result = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    expect(result).toBe('completed')

    const [match] = await database.sql<{ id: string; build: string; timelineKey: string; players: number }[]>`
      SELECT match.id, match.build, match.timeline_key AS "timelineKey",
        (SELECT count(*)::int FROM replays.match_players WHERE match_id = match.id) AS players
      FROM replays.matches AS match
    `

    expect(match).toMatchObject({ build: 'dev-1', timelineKey: `timelines/${match?.id}/dev-1.json.gz`, players: 2 })
    expect(deps.objectStore.keys()).toContain(match?.timelineKey as string)
    expect(await uploadStatus(outcome?.uploadId ?? null)).toEqual({ status: 'done', code: null })
  })

  test('an uploader not in the match is rejected, and the file deleted when nobody owns it', async () => {
    const replay = fakeReplay()
    const outcome = await uploadAs(await playerAccount(5555), replay.bytes)
    const claimed = await claimJob(deps, report)

    const result = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    expect(result).toBe('failed')
    expect(await uploadStatus(outcome?.uploadId ?? null)).toEqual({ status: 'rejected', code: 'not-your-match' })
    expect(deps.objectStore.keys()).not.toContain(`replays/${replay.hex}.replay`)

    const [matches] = await database.sql<{ count: number }[]>`SELECT count(*)::int AS count FROM replays.matches`

    expect(matches?.count).toBe(0)
  })

  test('an operator upload owns any match', async () => {
    const outcome = await uploadAs(await playerAccount(null), fakeReplay().bytes, true)
    const claimed = await claimJob(deps, report)

    const result = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    expect(result).toBe('completed')
    expect((await uploadStatus(outcome?.uploadId ?? null))?.status).toBe('done')
  })

  test('a later upload of a parsed file joins its match at once, if the uploader played in it', async () => {
    const replay = fakeReplay()

    await uploadAs(await playerAccount(1001), replay.bytes)

    const claimed = await claimJob(deps, report)

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    const teammate = await uploadAs(await playerAccount(1002), replay.bytes)
    const stranger = await uploadAs(await playerAccount(7777), replay.bytes)

    expect(teammate).toMatchObject({ status: 'done', rejection: null })
    expect(teammate?.matchId).toBeString()
    expect(stranger).toMatchObject({ status: 'rejected', rejection: 'not-your-match', matchId: null })
    expect(await claimJob(deps, report)).toBeNull()
  })

  test('a patch-not-supported failure is final and not retried', async () => {
    const outcome = await uploadAs(await playerAccount(1001))
    const claimed = await claimJob(deps, report)

    const failed = await failJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      code: 'patch-not-supported',
      message: 'replay version 260',
    })

    expect(failed).toBe(true)
    expect(await uploadStatus(outcome?.uploadId ?? null)).toEqual({ status: 'rejected', code: 'patch-not-supported' })
    expect(await claimJob(deps, report)).toBeNull()
  })

  test('an expired lease is claimed again, and fails with worker-error after 3 attempts', async () => {
    const outcome = await uploadAs(await playerAccount(1001))

    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await claimJob(deps, report)

      expect(claimed).not.toBeNull()
      await expireLease(claimed?.jobId as string)
    }

    expect(await claimJob(deps, report)).toBeNull()
    expect(await uploadStatus(outcome?.uploadId ?? null)).toEqual({ status: 'rejected', code: 'worker-error' })
  })

  test('a result after the lease expired is refused and stores nothing', async () => {
    await uploadAs(await playerAccount(1001))

    const claimed = await claimJob(deps, report)

    await expireLease(claimed?.jobId as string)

    const result = await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    expect(result).toBe('lease-lost')
    expect(deps.objectStore.keys().filter((key) => key.startsWith('timelines/'))).toEqual([])
  })

  test('renewing keeps a lease and releasing gives the job back without using an attempt', async () => {
    await uploadAs(await playerAccount(1001))

    const claimed = await claimJob(deps, report)

    expect(await renewLease(deps, claimed?.jobId as string, claimed?.leaseToken as string)).toBe(true)
    expect(await releaseJob(deps, claimed?.jobId as string, claimed?.leaseToken as string)).toBe(true)
    expect(await renewLease(deps, claimed?.jobId as string, claimed?.leaseToken as string)).toBe(false)

    const [job] = await database.sql<{ status: string; attempts: number }[]>`SELECT status, attempts FROM replays.jobs`

    expect(job).toEqual({ status: 'pending', attempts: 0 })
  })

  test('a re-parse replaces the stats and deletes the old timeline object', async () => {
    const replay = fakeReplay()

    await uploadAs(await playerAccount(1001), replay.bytes)

    const first = await claimJob(deps, report)

    await completeJob(deps, {
      jobId: first?.jobId as string,
      leaseToken: first?.leaseToken as string,
      line: makeLine(),
    })

    await database.sql`INSERT INTO replays.jobs (digest, kind) VALUES (${replay.digest}, 'reparse')`

    const second = await claimJob(deps, { build: 'dev-2', patches: ['11.00'] })

    const result = await completeJob(deps, {
      jobId: second?.jobId as string,
      leaseToken: second?.leaseToken as string,
      line: makeLine({ isReliable: false }),
    })

    expect(result).toBe('completed')

    const [match] = await database.sql<{ id: string; build: string; isReliable: boolean }[]>`
      SELECT id, build, is_reliable AS "isReliable" FROM replays.matches
    `

    expect(match).toMatchObject({ build: 'dev-2', isReliable: false })

    expect(deps.objectStore.keys().filter((key) => key.startsWith('timelines/'))).toEqual([
      `timelines/${match?.id}/dev-2.json.gz`,
    ])
  })

  test('a teammate uploading the same file while it is being stored joins the match', async () => {
    const replay = fakeReplay()
    const owner = await playerAccount(1001)
    const teammate = await playerAccount(1002)

    await uploadAs(owner, replay.bytes)

    const claimed = await claimJob(deps, report)
    let teammateUpload: ReturnType<typeof uploadReplays> | null = null
    const accounts = deps.accounts

    // the teammate's upload starts while the worker's answer is being stored, and isn't waited for there
    deps = {
      ...deps,
      accounts: {
        getPrimaryPlayerVerificationState: (accountId: string) => {
          teammateUpload ??= uploadReplays(
            { ...deps, accounts },
            { accountId: teammate, isOperator: false, files: [new File([new Uint8Array(replay.bytes)], 'b.replay')] },
          )

          return accounts.getPrimaryPlayerVerificationState(accountId)
        },
      } as unknown as Accounts,
    }

    await completeJob(deps, {
      jobId: claimed?.jobId as string,
      leaseToken: claimed?.leaseToken as string,
      line: makeLine(),
    })

    const [outcome] = await (teammateUpload as unknown as ReturnType<typeof uploadReplays>)

    const [row] = await database.sql<{ status: string }[]>`
      SELECT status FROM replays.uploads WHERE account_id = ${teammate}
    `

    expect(row?.status).toBe('done')
    expect(outcome?.status).not.toBe('rejected')
  })

  test('a failure from an attempt whose lease was taken over in the meantime changes nothing', async () => {
    const upload = await uploadAs(await playerAccount(1001))
    const claimed = await claimJob(deps, report)
    const jobId = claimed?.jobId as string

    let letTakeoverFinish = () => {}

    const takeoverMayFinish = new Promise<void>((resolve) => {
      letTakeoverFinish = resolve
    })

    let markRowLocked = () => {}

    const rowLocked = new Promise<void>((resolve) => {
      markRowLocked = resolve
    })

    // a new claim holds the row while the old attempt's failure arrives, then gives the job a new lease
    const takeover = database.sql.begin(async (transaction) => {
      await transaction`SELECT 1 FROM replays.jobs WHERE id = ${jobId} FOR UPDATE`
      markRowLocked()
      await takeoverMayFinish
      await transaction`UPDATE replays.jobs SET lease_token = gen_random_uuid(), attempts = attempts + 1 WHERE id = ${jobId}`
    })

    await rowLocked

    const failure = failJob(deps, {
      jobId,
      leaseToken: claimed?.leaseToken as string,
      code: 'game-error',
      message: 'from the old attempt',
    })

    await waitForLockWait()
    letTakeoverFinish()
    await takeover

    expect(await failure).toBe(false)

    const [job] = await database.sql<{ status: string }[]>`SELECT status FROM replays.jobs WHERE id = ${jobId}`

    expect(job?.status).toBe('processing')
    expect((await uploadStatus(upload?.uploadId ?? null))?.status).not.toBe('rejected')
  })

  // resolves once a query in this test database waits for a row lock
  async function waitForLockWait(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await database.sql<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `

      if ((row?.waiting ?? 0) > 0) return

      await Bun.sleep(10)
    }

    throw new Error('no query started waiting for the job row')
  }
})
