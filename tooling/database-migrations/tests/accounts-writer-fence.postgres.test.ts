import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { AccountsMaintenanceError, createPostgresAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { migratePostgres } from '../src/postgres'

// The writer maintenance fence outlived the V2 Accounts importer that introduced it: runtime writers still take it
// shared, so maintenance can pause every Accounts write by holding it exclusively.
const fenceLock = "hashtextextended('accounts:writer-maintenance-fence', 0)"
const connectionString = process.env.DATABASE_URL
let admin: ReturnType<typeof postgres> | undefined

beforeAll(async () => {
  if (!connectionString) return
  const adminUrl = new URL(connectionString)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
})

afterAll(async () => {
  await admin?.end()
})

async function withDatabase(run: (databaseUrl: string, accountId: string) => Promise<void>): Promise<void> {
  const databaseName = `brawltome_accounts_fence_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const databaseUrl = new URL(connectionString as string)
  databaseUrl.pathname = `/${databaseName}`
  await admin?.unsafe(`CREATE DATABASE "${databaseName}"`)
  try {
    await migratePostgres(databaseUrl.toString(), globalMigrationInventory)
    const setup = createPostgresAccounts(databaseUrl.toString())
    let accountId: string
    try {
      const { account } = await setup.accounts.signInWithDiscord({
        providerAccountId: 'fence-owner',
        displayName: 'Fence owner',
        avatarHash: null,
      })
      accountId = account.id
    } finally {
      await setup.close()
    }
    await run(databaseUrl.toString(), accountId)
  } finally {
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  }
}

async function waitForAdvisoryWaiters(
  probe: ReturnType<typeof postgres>,
  mode: 'ShareLock' | 'ExclusiveLock',
  minimum: number,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const [state] = await probe.unsafe<Array<{ waiters: number }>>(
      `SELECT count(*)::integer AS waiters
       FROM pg_locks
       WHERE locktype = 'advisory'
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND mode = $1
         AND NOT granted`,
      [mode],
    )
    if (state.waiters >= minimum) return
    await Bun.sleep(10)
  }
  throw new Error(`Expected ${minimum} waiting ${mode} Accounts advisory locks`)
}

describe.skipIf(!connectionString)('Accounts writer maintenance fence', () => {
  test('runtime writers wait behind the fence and complete once it is released', async () => {
    await withDatabase(async (databaseUrl, accountId) => {
      const fence = postgres(databaseUrl, { max: 1 })
      const inspect = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let fenceHeld = false
      let settled = 0
      let writers: Array<Promise<unknown>> = []
      try {
        await fence.unsafe(`SELECT pg_advisory_lock(${fenceLock})`)
        fenceHeld = true
        writers = [
          runtime.accounts.updatePreferences(accountId, { leaderboardBracket: '2v2', leaderboardRegion: 'EU' }),
          runtime.accounts.signInWithDiscord({
            providerAccountId: 'fenced-discord-writer',
            displayName: 'Fenced writer',
            avatarHash: null,
          }),
          runtime.accounts.pinPlayer(accountId, 424242),
        ].map((writer) =>
          writer.finally(() => {
            settled += 1
          }),
        )
        await waitForAdvisoryWaiters(inspect, 'ShareLock', writers.length)
        expect(settled).toBe(0)

        await fence.unsafe(`SELECT pg_advisory_unlock(${fenceLock})`)
        fenceHeld = false
        await Promise.all(writers)
        const [after] = await inspect<Array<{ preferences: number; saved: number; identities: number }>>`
          SELECT
            (SELECT count(*)::integer FROM accounts.preferences) AS preferences,
            (SELECT count(*)::integer FROM accounts.pinned_players) AS saved,
            (SELECT count(*)::integer FROM accounts.oauth_identities
             WHERE provider_account_id = 'fenced-discord-writer') AS identities
        `
        expect(after).toEqual({ preferences: 1, saved: 1, identities: 1 })
      } finally {
        if (fenceHeld) await fence.unsafe(`SELECT pg_advisory_unlock(${fenceLock})`)
        await Promise.allSettled(writers)
        await runtime.close()
        await inspect.end()
        await fence.end()
      }
    })
  }, 15_000)

  test('a writer held too long fails with a bounded retryable maintenance signal', async () => {
    await withDatabase(async (databaseUrl, accountId) => {
      const fence = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let fenceHeld = false
      try {
        await fence.unsafe(`SELECT pg_advisory_lock(${fenceLock})`)
        fenceHeld = true
        const startedAt = Date.now()
        const write = runtime.accounts.updatePreferences(accountId, {
          leaderboardBracket: '2v2',
          leaderboardRegion: 'EU',
        })
        await expect(write).rejects.toMatchObject({ name: AccountsMaintenanceError.name, retryAfterSeconds: 5 })
        expect(Date.now() - startedAt).toBeLessThan(5_000)
      } finally {
        if (fenceHeld) await fence.unsafe(`SELECT pg_advisory_unlock(${fenceLock})`)
        await runtime.close()
        await fence.end()
      }
    })
  }, 15_000)

  test('ordinary Accounts lock contention is not reported as maintenance', async () => {
    await withDatabase(async (databaseUrl) => {
      const contention = "hashtextextended('discord:ordinary-contention', 0)"
      const blocker = postgres(databaseUrl, { max: 1 })
      const probe = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let blockerHeld = false
      let signIn: Promise<unknown> | null = null
      try {
        await blocker.unsafe(`SELECT pg_advisory_lock(${contention})`)
        blockerHeld = true
        let settled = false
        signIn = runtime.accounts
          .signInWithDiscord({
            providerAccountId: 'ordinary-contention',
            displayName: 'Ordinary contention',
            avatarHash: null,
          })
          .finally(() => {
            settled = true
          })
        await waitForAdvisoryWaiters(probe, 'ExclusiveLock', 1)
        await Bun.sleep(1_100)
        expect(settled).toBe(false)

        await blocker.unsafe(`SELECT pg_advisory_unlock(${contention})`)
        blockerHeld = false
        await expect(signIn).resolves.toMatchObject({ account: { displayName: 'Ordinary contention' } })
      } finally {
        if (blockerHeld) await blocker.unsafe(`SELECT pg_advisory_unlock(${contention})`)
        if (signIn) await Promise.allSettled([signIn])
        await runtime.close()
        await probe.end()
        await blocker.end()
      }
    })
  }, 15_000)
})
