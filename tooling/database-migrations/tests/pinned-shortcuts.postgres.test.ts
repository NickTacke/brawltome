import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { MAX_PINNED_PLAYERS, accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { migratePostgres } from '../src/postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const hasDedicatedServer = configuredServer?.startsWith(dedicatedServer) ?? false

async function withDatabase(run: (databaseUrl: string) => Promise<void>) {
  if (!hasDedicatedServer) throw new Error('Pinned shortcut PostgreSQL tests require dedicated 127.0.0.1:55436')

  const databaseName = `brawltome_pins_${process.pid}_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(configuredServer as string)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(configuredServer as string)
  databaseUrl.pathname = `/${databaseName}`
  const admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  try {
    await run(databaseUrl.toString())
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
}

async function signIn(runtime: ReturnType<typeof createPostgresAccounts>, providerAccountId: string) {
  return runtime.accounts.signInWithDiscord({ providerAccountId, displayName: providerAccountId, avatarHash: null })
}

async function verifyPrimary(
  runtime: ReturnType<typeof createPostgresAccounts>,
  accountId: string,
  brawlhallaId: number,
) {
  const attempt = await runtime.accounts.beginPrimaryPlayerVerification({
    accountId,
    steamId: `steam-${brawlhallaId}`,
    idempotencyKey: `primary-${accountId}-${brawlhallaId}`,
  })
  return runtime.accounts.resolvePrimaryPlayerVerification(attempt.id, {
    resolve: async () => ({
      brawlhallaId,
      name: `Player ${brawlhallaId}`,
      checkedAt: new Date('2026-08-10T10:00:00.000Z'),
      source: 'brawlhalla-v0-steam-search',
    }),
  })
}

function pinnedIds(
  snapshot: Awaited<ReturnType<ReturnType<typeof createPostgresAccounts>['accounts']['getPlayerShortcuts']>>,
) {
  return snapshot.pinnedPlayers.map(({ brawlhallaId }) => brawlhallaId)
}

async function expectDatabaseError(query: PromiseLike<unknown>, message: string) {
  let databaseError: unknown
  try {
    await query
  } catch (error) {
    databaseError = error
  }
  expect(databaseError).toBeInstanceOf(Error)
  expect((databaseError as Error).message).toContain(message)
}

async function waitForBlockedTransaction(sql: ReturnType<typeof postgres>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [state] = await sql<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity activity
        WHERE activity.datname = current_database()
          AND cardinality(pg_blocking_pids(activity.pid)) > 0
      ) AS blocked
    `
    if (state?.blocked) return
    await Bun.sleep(10)
  }
  throw new Error('Expected a transaction to wait on the account personalization lock')
}

describe.skipIf(!hasDedicatedServer)('Pinned Player shortcuts PostgreSQL', () => {
  test('keeps a stable manually ordered subset of four saved non-primary players', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      let runtime = createPostgresAccounts(databaseUrl)
      const signedIn = await signIn(runtime, 'pin-stability')
      const accountId = signedIn.account.id
      try {
        await Promise.all([41, 42, 43, 44, 45].map((id) => runtime.accounts.savePlayer(accountId, id)))
        for (const id of [44, 42, 45, 43]) await runtime.accounts.pinSavedPlayer(accountId, id)

        expect(MAX_PINNED_PLAYERS).toBe(4)
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(accountId))).toEqual([44, 42, 45, 43])
        await expect(runtime.accounts.pinSavedPlayer(accountId, 41)).rejects.toThrow('cannot exceed 4')
        await expect(runtime.accounts.pinSavedPlayer(accountId, 99)).rejects.toThrow('must be saved')

        await runtime.close()
        runtime = createPostgresAccounts(databaseUrl)
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(accountId))).toEqual([44, 42, 45, 43])
        expect(
          (await runtime.accounts.getSavedPlayers(accountId))
            .map(({ brawlhallaId, pinOrder }) => ({ brawlhallaId, pinOrder }))
            .sort((left, right) => left.brawlhallaId - right.brawlhallaId),
        ).toEqual([
          { brawlhallaId: 41, pinOrder: null },
          { brawlhallaId: 42, pinOrder: 1 },
          { brawlhallaId: 43, pinOrder: 3 },
          { brawlhallaId: 44, pinOrder: 0 },
          { brawlhallaId: 45, pinOrder: 2 },
        ])
      } finally {
        await runtime.close()
      }
    })
  }, 10_000)

  test('serializes repeated pins and competing complete reorders without mixed positions', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const { account } = await signIn(runtime, 'pin-concurrency')
        await Promise.all([42, 43, 44, 45].map((id) => runtime.accounts.savePlayer(account.id, id)))
        await Promise.all(
          Array.from({ length: 8 }, () => runtime.accounts.pinSavedPlayer(account.id, 42)).concat([
            runtime.accounts.pinSavedPlayer(account.id, 43),
            runtime.accounts.pinSavedPlayer(account.id, 44),
          ]),
        )
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(account.id)).sort()).toEqual([42, 43, 44])

        const requestedOrders = [
          [44, 43, 42],
          [43, 42, 44],
        ] as const
        const results = await Promise.all(
          requestedOrders.map((ids) => runtime.accounts.reorderPinnedPlayers(account.id, ids)),
        )
        expect(results.map((players) => players.map(({ brawlhallaId }) => brawlhallaId)).sort()).toEqual(
          requestedOrders.map((ids) => [...ids]).sort(),
        )
        const finalOrder = pinnedIds(await runtime.accounts.getPlayerShortcuts(account.id))
        expect(requestedOrders.some((ids) => ids.every((id, index) => id === finalOrder[index]))).toBe(true)
        await expect(runtime.accounts.reorderPinnedPlayers(account.id, [42, 43])).rejects.toThrow(
          'complete pinned collection',
        )
      } finally {
        await runtime.close()
      }
    })
  }, 10_000)

  test('isolates accounts and cascades save removal while compacting pin order', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const sql = postgres(databaseUrl, { max: 1 })
      try {
        const [{ account: first }, { account: second }] = await Promise.all([
          signIn(runtime, 'pin-private-first'),
          signIn(runtime, 'pin-private-second'),
        ])
        await Promise.all([42, 43, 44].map((id) => runtime.accounts.savePlayer(first.id, id)))
        await runtime.accounts.savePlayer(second.id, 42)
        for (const id of [42, 43, 44]) await runtime.accounts.pinSavedPlayer(first.id, id)
        await runtime.accounts.pinSavedPlayer(second.id, 42)

        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(first.id))).toEqual([42, 43, 44])
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(second.id))).toEqual([42])

        await Promise.all(Array.from({ length: 8 }, () => runtime.accounts.removeSavedPlayer(first.id, 43)))
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(first.id))).toEqual([42, 44])
        expect(pinnedIds(await runtime.accounts.getPlayerShortcuts(second.id))).toEqual([42])
        const [{ pins }] = await sql<[{ pins: number }]>`
          SELECT count(*)::int AS pins
          FROM accounts.saved_player_pins
          WHERE account_id = ${first.id} AND brawlhalla_id = 43
        `
        expect(pins).toBe(0)
      } finally {
        await runtime.close()
        await sql.end()
      }
    })
  }, 10_000)

  test('enforces saved membership, four slots, and Primary exclusion below the service seam', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const sql = postgres(databaseUrl, { max: 1 })
      try {
        const { account } = await signIn(runtime, 'pin-constraints')
        await Promise.all([42, 43, 44, 45, 46].map((id) => runtime.accounts.savePlayer(account.id, id)))
        await verifyPrimary(runtime, account.id, 42)

        await expectDatabaseError(
          sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 42, 0)`,
          'Primary Player',
        )
        await expectDatabaseError(
          sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 99, 0)`,
          'saved_player_fk',
        )
        await expectDatabaseError(
          sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 43, 4)`,
          'position_check',
        )

        await sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 43, 0)`
        await sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 44, 1)`
        await sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 45, 2)`
        await sql`INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES (${account.id}, 46, 3)`
        await sql`
          DELETE FROM accounts.saved_players
          WHERE account_id = ${account.id} AND brawlhalla_id IN (43, 45)
        `
        const remainingPins = await sql<{ brawlhalla_id: number; position: number }[]>`
          SELECT brawlhalla_id::int, position
          FROM accounts.saved_player_pins
          WHERE account_id = ${account.id}
          ORDER BY position
        `
        expect([...remainingPins]).toEqual([
          { brawlhalla_id: 44, position: 0 },
          { brawlhalla_id: 46, position: 1 },
        ])
      } finally {
        await runtime.close()
        await sql.end()
      }
    })
  }, 10_000)

  test('serializes raw Primary assignment against concurrent pin insertion', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const control = postgres(databaseUrl, { max: 1 })
      const primaryWriter = postgres(databaseUrl, { max: 1 })
      let releasePrimary = () => {}
      const releasePrimaryGate = new Promise<void>((resolve) => {
        releasePrimary = resolve
      })
      try {
        const { account } = await signIn(runtime, 'pin-primary-race')
        await runtime.accounts.savePlayer(account.id, 43)
        const attempt = await runtime.accounts.beginPrimaryPlayerVerification({
          accountId: account.id,
          steamId: 'steam-primary-race',
          idempotencyKey: 'primary-race',
        })
        await control`
          INSERT INTO accounts.primary_player_verification_outcomes (
            attempt_id, status, brawlhalla_id, player_name, evidence_source, evidence_checked_at, completed_at
          ) VALUES (${attempt.id}, 'verified', 43, 'Player 43', 'race-test', now(), now())
        `

        let markPrimaryInserted = () => {}
        const primaryInserted = new Promise<void>((resolve) => {
          markPrimaryInserted = resolve
        })
        const primaryAssignment = primaryWriter.begin(async (transaction) => {
          await transaction.unsafe(
            `INSERT INTO accounts.primary_players (
               account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id
             ) VALUES ($1, 43, 'Player 43', now(), $2)`,
            [account.id, attempt.id],
          )
          markPrimaryInserted()
          await releasePrimaryGate
        })
        await primaryInserted

        const pinAttempt = runtime.accounts.pinSavedPlayer(account.id, 43)
        await waitForBlockedTransaction(control)
        releasePrimary()
        await primaryAssignment
        await expect(pinAttempt).rejects.toThrow('Primary Player')

        const shortcuts = await runtime.accounts.getPlayerShortcuts(account.id)
        expect(shortcuts.primaryPlayer?.brawlhallaId).toBe(43)
        expect(shortcuts.pinnedPlayers).toEqual([])
      } finally {
        releasePrimary()
        await runtime.close()
        await control.end()
        await primaryWriter.end()
      }
    })
  }, 10_000)

  test('serializes pin-first raw insertion against concurrent save deletion without deadlock', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const control = postgres(databaseUrl, { max: 1 })
      const pinWriter = postgres(databaseUrl, { max: 1 })
      const deleteWriter = postgres(databaseUrl, { max: 1 })
      let releasePin = () => {}
      const releasePinGate = new Promise<void>((resolve) => {
        releasePin = resolve
      })
      try {
        const { account } = await signIn(runtime, 'pin-first-delete-race')
        await runtime.accounts.savePlayer(account.id, 52)

        let markPinned = () => {}
        const pinned = new Promise<void>((resolve) => {
          markPinned = resolve
        })
        const pinInsertion = pinWriter.begin(async (transaction) => {
          await transaction.unsafe(
            'INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position) VALUES ($1, 52, 0)',
            [account.id],
          )
          markPinned()
          await releasePinGate
        })
        await pinned

        const deletion = (async () => {
          await deleteWriter.unsafe('DELETE FROM accounts.saved_players WHERE account_id = $1 AND brawlhalla_id = 52', [
            account.id,
          ])
        })()
        await waitForBlockedTransaction(control)
        releasePin()
        await pinInsertion
        await deletion

        expect(await runtime.accounts.getSavedPlayers(account.id)).toEqual([])
        expect((await runtime.accounts.getPlayerShortcuts(account.id)).pinnedPlayers).toEqual([])
      } finally {
        releasePin()
        await runtime.close()
        await control.end()
        await pinWriter.end()
        await deleteWriter.end()
      }
    })
  }, 10_000)

  test('serializes raw save deletion against concurrent pin insertion', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const control = postgres(databaseUrl, { max: 1 })
      const deleteWriter = postgres(databaseUrl, { max: 1 })
      let releaseDelete = () => {}
      const releaseDeleteGate = new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
      try {
        const { account } = await signIn(runtime, 'pin-delete-race')
        await runtime.accounts.savePlayer(account.id, 51)

        let markDeleted = () => {}
        const deleted = new Promise<void>((resolve) => {
          markDeleted = resolve
        })
        const deletion = deleteWriter.begin(async (transaction) => {
          await transaction.unsafe('DELETE FROM accounts.saved_players WHERE account_id = $1 AND brawlhalla_id = 51', [
            account.id,
          ])
          markDeleted()
          await releaseDeleteGate
        })
        await deleted

        const pinAttempt = runtime.accounts.pinSavedPlayer(account.id, 51)
        await waitForBlockedTransaction(control)
        releaseDelete()
        await deletion
        await expect(pinAttempt).rejects.toThrow('must be saved')
        expect(await runtime.accounts.getSavedPlayers(account.id)).toEqual([])
      } finally {
        releaseDelete()
        await runtime.close()
        await control.end()
        await deleteWriter.end()
      }
    })
  }, 10_000)

  test('renders Primary first conceptually and evicts a pin when Primary assignment changes', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const sql = postgres(databaseUrl, { max: 1 })
      try {
        const { account } = await signIn(runtime, 'pin-primary')
        await Promise.all([42, 43, 44].map((id) => runtime.accounts.savePlayer(account.id, id)))
        await verifyPrimary(runtime, account.id, 42)
        await expect(runtime.accounts.pinSavedPlayer(account.id, 42)).rejects.toThrow('Primary Player')
        await runtime.accounts.pinSavedPlayer(account.id, 43)
        await runtime.accounts.pinSavedPlayer(account.id, 44)

        await sql`DELETE FROM accounts.primary_players WHERE account_id = ${account.id}`
        expect((await verifyPrimary(runtime, account.id, 43)).status).toBe('verified')

        const shortcuts = await runtime.accounts.getPlayerShortcuts(account.id)
        expect(shortcuts.primaryPlayer?.brawlhallaId).toBe(43)
        expect(pinnedIds(shortcuts)).toEqual([44])
      } finally {
        await runtime.close()
        await sql.end()
      }
    })
  }, 10_000)
})
