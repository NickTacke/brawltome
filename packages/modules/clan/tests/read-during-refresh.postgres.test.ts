import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { clanModule, createPostgresClans } from '../index'

const clanId = 990090
const snapshotClanId = 990091
const oldRosterAt = new Date('2026-08-10T10:00:00.000Z')
const newRosterAt = new Date('2026-08-10T11:00:00.000Z')
const rosterProvenance = { source: 'v1-guild-members', outcome: 'success' } as const
const readTimeoutMs = 2_000
const lockWaitPollMs = 10
const lockWaitTimeoutMs = 3_000

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'clan_read_during_refresh',
    modules: [refreshOperationsModule, clanModule],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

const profile = {
  clanId,
  clanName: 'Busy Clan',
  clanCreateDate: new Date('2024-01-01T00:00:00.000Z'),
  clanXp: '10',
  clanLifetimeXp: '10',
  notice: '',
  tags: [],
  discordInviteCode: '',
  guildPoints: '0',
  isRecruiting: false,
}

function member(brawlhallaId: number, xp: string) {
  return {
    brawlhallaId,
    name: `Player ${brawlhallaId}`,
    rank: 'Member',
    joinDate: new Date('2025-01-01T00:00:00.000Z'),
    xp,
    guildPoints: '0',
  }
}

type StoredClan = Awaited<ReturnType<ReturnType<typeof createPostgresClans>['getById']>>

function rosterOf(clan: StoredClan) {
  return clan?.members.map(({ brawlhallaId, xp }) => ({ brawlhallaId, xp }))
}

// locks one member row from its own connection, as a concurrent writer would, until release is called
async function lockMember(brawlhallaId: number): Promise<{ release(): Promise<void> }> {
  const lockHolder = postgres(database.connectionString, { max: 1 })
  const acquired = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()

  const transaction = lockHolder.begin(async (sql) => {
    await sql`SELECT 1 FROM clans.members WHERE brawlhalla_id = ${brawlhallaId} FOR UPDATE`
    acquired.resolve()
    await released.promise
  })

  await Promise.race([acquired.promise, transaction])
  let releasing: Promise<void> | undefined

  const release = async () => {
    released.resolve()
    await transaction
    await lockHolder.end()
  }

  return {
    release() {
      releasing ??= release()

      return releasing
    },
  }
}

type MembersTableLock = { commitWith(write: (sql: postgres.TransactionSql) => Promise<unknown>): Promise<void> }

// locks clans.members against reads too, so a read that reaches the members table waits until the lock holder
// commits its writes
async function lockMembersTable(): Promise<MembersTableLock> {
  const lockHolder = postgres(database.connectionString, { max: 1 })
  const acquired = Promise.withResolvers<void>()
  const writes = Promise.withResolvers<(sql: postgres.TransactionSql) => Promise<unknown>>()

  const transaction = lockHolder.begin(async (sql) => {
    await sql`LOCK TABLE clans.members IN ACCESS EXCLUSIVE MODE`
    acquired.resolve()
    const write = await writes.promise

    await write(sql)
  })

  await Promise.race([acquired.promise, transaction])
  let committing: Promise<void> | undefined

  const commit = async () => {
    await transaction
    await lockHolder.end()
  }

  return {
    commitWith(write) {
      writes.resolve(write)
      committing ??= commit()

      return committing
    },
  }
}

async function pollForLockWait(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const [row] = await database.sql<{ waiting: number }[]>`
      SELECT count(*)::integer AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `

    if (row?.waiting) return

    await Bun.sleep(lockWaitPollMs)
  }
}

// an operation that settles before it reaches the lock can't be waiting on it, so the test fails at once rather
// than polling until the deadline
function failWhenSettled(operation: Promise<unknown>, what: string): Promise<never> {
  return operation.then(
    () => {
      throw new Error(`${what} finished before it waited on the lock`)
    },
    (error: unknown) => {
      throw new Error(`${what} failed before it waited on the lock`, { cause: error })
    },
  )
}

/** Resolves once some query in the test database waits on a lock; fails if the operation settles first. */
async function waitForLockWait(operation: Promise<unknown>, what: string): Promise<void> {
  const polling = new AbortController()
  const lockWait = Promise.race([pollForLockWait(polling.signal), failWhenSettled(operation, what)])

  try {
    await finishesWithin(lockWait, lockWaitTimeoutMs, `${what} waiting on the lock`)
  } finally {
    polling.abort()
  }
}

async function finishesWithin<Result>(promise: Promise<Result>, timeoutMs: number, what: string): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

describe('reading a clan while its roster refresh is in flight', () => {
  test('returns the old roster at once, then the new roster after the refresh commits', async () => {
    const clans = createPostgresClans(database)

    await clans.publishProfile(profile, oldRosterAt, { source: 'v1-guild-stats', outcome: 'success' })
    await clans.publishRoster(clanId, [member(1, '5'), member(2, '4')], oldRosterAt, rosterProvenance)

    const effect = {
      operationId: randomUUID(),
      section: 'roster' as const,
      leaseToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }

    expect(await clans.prepareRefreshEffect(effect)).toBe('execute')

    // the refresh removes player 2 and adds player 3, then waits on this lock to update player 1, so its
    // transaction stays open with uncommitted roster writes
    const lock = await lockMember(1)

    try {
      const newRoster = [member(3, '7'), member(1, '6')]
      const refresh = clans.publishRoster(clanId, newRoster, newRosterAt, rosterProvenance, effect)

      await waitForLockWait(refresh, 'the roster refresh')
      const during = await finishesWithin(clans.getById(clanId), readTimeoutMs, 'read during the refresh')

      await lock.release()
      expect(await refresh).toBe('applied')
      const after = await clans.getById(clanId)

      expect(rosterOf(during)).toEqual([
        { brawlhallaId: 1, xp: '5' },
        { brawlhallaId: 2, xp: '4' },
      ])

      expect(during?.roster?.lastSuccessAt).toEqual(oldRosterAt)

      expect(rosterOf(after)).toEqual([
        { brawlhallaId: 3, xp: '7' },
        { brawlhallaId: 1, xp: '6' },
      ])

      expect(after?.roster?.lastSuccessAt).toEqual(newRosterAt)
    } finally {
      await lock.release()
    }
  })

  test('reads the profile, roster state and members from one snapshot', async () => {
    const clans = createPostgresClans(database)
    const oldRoster = [member(11, '5'), member(12, '4')]

    await clans.publishProfile({ ...profile, clanId: snapshotClanId }, oldRosterAt, {
      source: 'v1-guild-stats',
      outcome: 'success',
    })

    await clans.publishRoster(snapshotClanId, oldRoster, oldRosterAt, rosterProvenance)
    const lock = await lockMembersTable()

    try {
      // the read gets the profile and the roster state, then waits on the lock to read the members; the roster
      // change commits while it waits
      const read = clans.getById(snapshotClanId)

      await waitForLockWait(read, 'the clan read')

      await lock.commitWith(async (sql) => {
        await sql`
          UPDATE clans.roster_state SET checked_at = ${newRosterAt}, last_success_at = ${newRosterAt}
          WHERE clan_id = ${snapshotClanId}
        `

        await sql`DELETE FROM clans.members WHERE clan_id = ${snapshotClanId} AND brawlhalla_id = 12`
      })

      const during = await read
      const after = await clans.getById(snapshotClanId)

      expect(during?.roster?.lastSuccessAt).toEqual(oldRosterAt)

      expect(rosterOf(during)).toEqual([
        { brawlhallaId: 11, xp: '5' },
        { brawlhallaId: 12, xp: '4' },
      ])

      expect(after?.roster?.lastSuccessAt).toEqual(newRosterAt)
      expect(rosterOf(after)).toEqual([{ brawlhallaId: 11, xp: '5' }])
    } finally {
      await lock.commitWith(async () => undefined)
    }
  })
})
