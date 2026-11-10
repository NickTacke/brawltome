import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { inspect } from 'node:util'
import type { Database } from '@brawltome/foundation'
import { createTestDatabase, openTestClient, type TestDatabase } from '@brawltome/foundation/testing'
import { analyticsModule, createPostgresDailySalts } from '../index'

const today = '2026-11-10'
const tomorrow = '2026-11-11'

let database: TestDatabase
// a second client on the same database, like the api container that starts beside the old one in a deploy
let otherProcess: Database

beforeAll(async () => {
  database = await createTestDatabase({ label: 'analytics_daily_salts', modules: [analyticsModule] })
  otherProcess = openTestClient(database.connectionString)
}, 20_000)

afterAll(async () => {
  await otherProcess?.close()
  await database?.drop()
}, 20_000)

beforeEach(async () => {
  await database.sql`TRUNCATE analytics.daily_salts`
})

async function storedDays(): Promise<string[]> {
  const rows = await database.sql<{ day: string }[]>`
    SELECT day::text AS day FROM analytics.daily_salts ORDER BY day
  `

  return rows.map(({ day }) => day)
}

function hex(salt: Uint8Array): string {
  return Buffer.from(salt).toString('hex')
}

describe('daily salts', () => {
  test('a day has one salt of 32 random bytes, however often it is asked for', async () => {
    const salts = createPostgresDailySalts(database)
    const first = await salts.saltFor(today)

    expect(first).toHaveLength(32)
    expect(hex(await salts.saltFor(today))).toBe(hex(first))
    expect(await storedDays()).toEqual([today])
  })

  test('a process that starts later the same day reads the salt the first one made', async () => {
    const first = await createPostgresDailySalts(database).saltFor(today)
    const second = await createPostgresDailySalts(otherProcess).saltFor(today)

    expect(hex(second)).toBe(hex(first))
  })

  test('processes that ask at the same moment all get the same salt', async () => {
    const clients = [database, otherProcess, database, otherProcess, database, otherProcess]
    const salts = await Promise.all(clients.map((client) => createPostgresDailySalts(client).saltFor(today)))

    expect(new Set(salts.map(hex)).size).toBe(1)
    expect(await storedDays()).toEqual([today])
  })

  test('the next day gets a new salt and the older ones are deleted', async () => {
    const salts = createPostgresDailySalts(database)

    await salts.saltFor('2026-11-08')
    const todaysSalt = await salts.saltFor(today)
    const tomorrowsSalt = await createPostgresDailySalts(otherProcess).saltFor(tomorrow)

    expect(hex(tomorrowsSalt)).not.toBe(hex(todaysSalt))
    expect(await storedDays()).toEqual([tomorrow])
  })

  test('a day asked for again after it ended gets a new salt, the old one is gone', async () => {
    const salts = createPostgresDailySalts(database)
    const first = await salts.saltFor(today)

    await salts.saltFor(tomorrow)

    expect(hex(await salts.saltFor(today))).not.toBe(hex(first))
  })

  // two processes rarely agree on the exact moment of midnight: the one that is behind must not take away the salt
  // the other already uses for the new day
  test('a process still on the day before leaves the new day its salt', async () => {
    const tomorrowsSalt = await createPostgresDailySalts(database).saltFor(tomorrow)

    await createPostgresDailySalts(otherProcess).saltFor(today)

    expect(await storedDays()).toEqual([today, tomorrow])
    expect(hex(await createPostgresDailySalts(otherProcess).saltFor(tomorrow))).toBe(hex(tomorrowsSalt))
  })

  // drizzle writes a failed query's parameters into its error, and whoever catches that error may log it
  test('a failed query never carries the salt it tried to store', async () => {
    const closedClient = openTestClient(database.connectionString)

    await closedClient.close()

    const failure = await createPostgresDailySalts(closedClient)
      .saltFor(today)
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)

    expect(failure).toMatchObject({
      message: `ensure daily salt for ${today}: the insert failed`,
      code: 'CONNECTION_ENDED',
    })

    expect(inspect(failure, { showHidden: true, depth: 10 })).not.toMatch(/[0-9a-f]{64}/)
  })
})
