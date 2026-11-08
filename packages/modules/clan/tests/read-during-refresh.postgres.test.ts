import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import postgres from 'postgres'
import { clanModule, createPostgresClans } from '../index'

const clanId = 990090
const oldRosterAt = new Date('2026-08-10T10:00:00.000Z')
const newRosterAt = new Date('2026-08-10T11:00:00.000Z')
const rosterProvenance = { source: 'v1-guild-members', outcome: 'success' } as const
const readTimeoutMs = 2_000
const lockWaitPollMs = 10

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_read_during_refresh', modules: [clanModule] })
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

// one digit of xp each, so the order is the same whether xp sorts as text or as a number
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

async function waitForLockWait(): Promise<void> {
  for (;;) {
    const [row] = await database.sql<{ waiting: number }[]>`
      SELECT count(*)::integer AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `

    if (row?.waiting) return

    await Bun.sleep(lockWaitPollMs)
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

      await waitForLockWait()
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
})
