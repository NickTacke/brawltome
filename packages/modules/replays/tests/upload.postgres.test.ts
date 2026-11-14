import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createMemoryObjectStore, createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { replaysModule } from '../index'
import { MAX_REPLAY_BYTES } from '../limits'
import { uploadReplays } from '../upload'
import { fakeReplay } from './fixtures/replays'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('uploading replays', () => {
  let database: TestDatabase
  let objectStore: ReturnType<typeof createMemoryObjectStore>

  beforeAll(async () => {
    database = await createTestDatabase({ label: 'replays_upload', modules: [...accountsTestModules, replaysModule] })
  }, 20_000)

  afterAll(async () => {
    await database?.drop()
  }, 20_000)

  beforeEach(() => {
    objectStore = createMemoryObjectStore()
  })

  async function newAccount(): Promise<string> {
    const accountId = randomUUID()

    await database.sql`INSERT INTO accounts.users (id) VALUES (${accountId})`

    return accountId
  }

  function upload(accountId: string, files: { name: string; bytes: Uint8Array }[]) {
    return uploadReplays({ database, objectStore, accounts: {} as Accounts }, { accountId, isOperator: false, files })
  }

  async function jobCount(digest: string): Promise<number> {
    const [row] = await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM replays.jobs WHERE digest = ${digest}
    `

    return row?.count ?? 0
  }

  test('queues a valid replay', async () => {
    const accountId = await newAccount()
    const replay = fakeReplay()

    const [outcome] = await upload(accountId, [{ name: '[11.00] Map.replay', bytes: replay.bytes }])

    expect(outcome).toMatchObject({ fileName: '[11.00] Map.replay', status: 'queued', matchId: null, rejection: null })
    expect(outcome?.uploadId).toBeString()
    expect(objectStore.keys()).toEqual([`replays/${replay.hex}.replay`])
    expect(await jobCount(replay.digest)).toBe(1)
  })

  test('rejects a file without the zlib header and writes nothing', async () => {
    const accountId = await newAccount()

    const [outcome] = await upload(accountId, [{ name: 'notes.txt', bytes: new TextEncoder().encode('hello') }])

    expect(outcome).toMatchObject({ uploadId: null, status: 'rejected', rejection: 'not-a-replay' })
    expect(objectStore.keys()).toEqual([])

    const [row] = await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM replays.uploads WHERE account_id = ${accountId}
    `

    expect(row?.count).toBe(0)
  })

  test('rejects a file over 2 MiB and writes nothing', async () => {
    const accountId = await newAccount()
    const replay = fakeReplay(MAX_REPLAY_BYTES + 1)

    const [outcome] = await upload(accountId, [{ name: 'big.replay', bytes: replay.bytes }])

    expect(outcome).toMatchObject({ status: 'rejected', rejection: 'too-large' })
    expect(objectStore.keys()).toEqual([])
  })

  test('a re-upload by the same account is a no-op', async () => {
    const accountId = await newAccount()
    const replay = fakeReplay()

    const [first] = await upload(accountId, [{ name: 'a.replay', bytes: replay.bytes }])
    const [second] = await upload(accountId, [{ name: 'a.replay', bytes: replay.bytes }])

    expect(second?.uploadId).toBe(first?.uploadId as string)
    expect(second?.status).toBe('queued')
    expect(await jobCount(replay.digest)).toBe(1)
  })

  test('a second account uploading the same file shares the job', async () => {
    const replay = fakeReplay()

    const [first] = await upload(await newAccount(), [{ name: 'a.replay', bytes: replay.bytes }])
    const [second] = await upload(await newAccount(), [{ name: 'b.replay', bytes: replay.bytes }])

    expect(second?.uploadId).not.toBe(first?.uploadId as string)
    expect(await jobCount(replay.digest)).toBe(1)
  })

  test('the 21st pending upload is refused', async () => {
    const accountId = await newAccount()
    const files = Array.from({ length: 21 }, (_, index) => ({ name: `${index}.replay`, bytes: fakeReplay().bytes }))

    const outcomes = await upload(accountId, files)

    expect(outcomes.slice(0, 20).every((outcome) => outcome.status === 'queued')).toBe(true)
    expect(outcomes[20]).toMatchObject({ status: 'rejected', rejection: 'too-many-pending' })
  })

  test('the 201st upload of the day is refused', async () => {
    const accountId = await newAccount()

    // 200 finished uploads today, so the pending limit isn't what stops the next one
    for (let index = 0; index < 200; index++) {
      const replay = fakeReplay()

      await database.sql`INSERT INTO replays.replay_files (digest, byte_size) VALUES (${replay.digest}, 30)`

      await database.sql`
        INSERT INTO replays.uploads (account_id, digest, byte_size, status)
        VALUES (${accountId}, ${replay.digest}, 30, 'done')
      `
    }

    const [outcome] = await upload(accountId, [{ name: 'one-more.replay', bytes: fakeReplay().bytes }])

    expect(outcome).toMatchObject({ status: 'rejected', rejection: 'daily-limit' })
  })

  test('re-parse jobs and finished uploads do not count against the pending limit', async () => {
    const accountId = await newAccount()

    // 20 finished uploads whose files are being re-parsed after a new bh-native build
    for (let index = 0; index < 20; index++) {
      const replay = fakeReplay()

      await database.sql`INSERT INTO replays.replay_files (digest, byte_size) VALUES (${replay.digest}, 64)`

      await database.sql`
        INSERT INTO replays.uploads (account_id, digest, byte_size, status, created_at)
        VALUES (${accountId}, ${replay.digest}, 64, 'done', clock_timestamp() - interval '2 days')
      `

      await database.sql`INSERT INTO replays.jobs (digest, kind) VALUES (${replay.digest}, 'reparse')`
    }

    const [outcome] = await upload(accountId, [{ name: 'new.replay', bytes: fakeReplay().bytes }])

    expect(outcome?.status).toBe('queued')
  })
})
