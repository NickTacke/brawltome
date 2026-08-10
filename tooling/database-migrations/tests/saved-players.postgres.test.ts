import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { MAX_SAVED_PLAYERS, accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { migratePostgres } from '../src/postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const hasDedicatedServer = configuredServer?.startsWith(dedicatedServer) ?? false

async function withDatabase(run: (databaseUrl: string) => Promise<void>) {
  if (!hasDedicatedServer) {
    throw new Error('Saved Players PostgreSQL tests require dedicated 127.0.0.1:55436')
  }

  const databaseName = `brawltome_saved_players_${process.pid}_${randomUUID().replaceAll('-', '')}`
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

describe.skipIf(!hasDedicatedServer)('Saved Players PostgreSQL', () => {
  test('keeps concurrent idempotent saves private to each account', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const [first, second] = await Promise.all([
          runtime.accounts.signInWithDiscord({
            providerAccountId: 'saved-players-first',
            displayName: 'First',
            avatarHash: null,
          }),
          runtime.accounts.signInWithDiscord({
            providerAccountId: 'saved-players-second',
            displayName: 'Second',
            avatarHash: null,
          }),
        ])

        const repeated = await Promise.all(
          Array.from({ length: 12 }, () => runtime.accounts.savePlayer(first.account.id, 42)),
        )

        expect(repeated.every((saved) => saved.brawlhallaId === 42)).toBe(true)
        expect(await runtime.accounts.getSavedPlayers(first.account.id)).toEqual([
          {
            brawlhallaId: 42,
            order: 0,
            savedAt: expect.any(Date),
          },
        ])
        expect(await runtime.accounts.getSavedPlayers(second.account.id)).toEqual([])

        await runtime.accounts.savePlayer(second.account.id, 42)
        expect(
          (await runtime.accounts.getSavedPlayers(second.account.id)).map(({ brawlhallaId }) => brawlhallaId),
        ).toEqual([42])
      } finally {
        await runtime.close()
      }
    })
  }, 10_000)

  test('removes idempotently and compacts the remaining order', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const signedIn = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'saved-players-remove',
          displayName: 'Remove',
          avatarHash: null,
        })
        await Promise.all([42, 43, 44].map((id) => runtime.accounts.savePlayer(signedIn.account.id, id)))

        await Promise.all(Array.from({ length: 8 }, () => runtime.accounts.removeSavedPlayer(signedIn.account.id, 43)))
        await runtime.accounts.removeSavedPlayer(signedIn.account.id, 999)

        expect(
          (await runtime.accounts.getSavedPlayers(signedIn.account.id)).map(({ brawlhallaId, order }) => ({
            brawlhallaId,
            order,
          })),
        ).toEqual([
          { brawlhallaId: 42, order: 0 },
          { brawlhallaId: 44, order: 1 },
        ])
      } finally {
        await runtime.close()
      }
    })
  }, 10_000)

  test('atomically bounds collection amplification while preserving idempotent saves', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const signedIn = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'saved-players-limit',
          displayName: 'Limit',
          avatarHash: null,
        })
        await Promise.all(
          Array.from({ length: MAX_SAVED_PLAYERS }, (_, index) =>
            runtime.accounts.savePlayer(signedIn.account.id, index + 1),
          ),
        )

        const overflow = await Promise.allSettled([
          runtime.accounts.savePlayer(signedIn.account.id, MAX_SAVED_PLAYERS + 1),
          runtime.accounts.savePlayer(signedIn.account.id, MAX_SAVED_PLAYERS + 2),
        ])
        expect(overflow.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
        expect(await runtime.accounts.savePlayer(signedIn.account.id, 1)).toMatchObject({ brawlhallaId: 1 })
        expect(await runtime.accounts.getSavedPlayers(signedIn.account.id)).toHaveLength(MAX_SAVED_PLAYERS)
      } finally {
        await runtime.close()
      }
    })
  }, 15_000)

  test('commits competing complete reorders without mixed or duplicate positions', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const signedIn = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'saved-players-order',
          displayName: 'Order',
          avatarHash: null,
        })
        await Promise.all([42, 43, 44].map((id) => runtime.accounts.savePlayer(signedIn.account.id, id)))

        const requestedOrders = [
          [44, 43, 42],
          [43, 42, 44],
        ] as const
        const results = await Promise.all(
          requestedOrders.map((ids) => runtime.accounts.reorderSavedPlayers(signedIn.account.id, ids)),
        )

        expect(results.map((players) => players.map(({ brawlhallaId }) => brawlhallaId)).sort()).toEqual(
          requestedOrders.map((ids) => [...ids]).sort(),
        )
        const finalOrder = (await runtime.accounts.getSavedPlayers(signedIn.account.id)).map(
          ({ brawlhallaId }) => brawlhallaId,
        )
        expect(requestedOrders.some((ids) => ids.every((id, index) => id === finalOrder[index]))).toBe(true)
        expect(
          (await runtime.accounts.reorderSavedPlayers(signedIn.account.id, finalOrder)).map(
            ({ brawlhallaId }) => brawlhallaId,
          ),
        ).toEqual(finalOrder)

        await expect(runtime.accounts.reorderSavedPlayers(signedIn.account.id, [42, 43])).rejects.toThrow(
          'complete collection',
        )
        expect((await runtime.accounts.getSavedPlayers(signedIn.account.id)).map(({ order }) => order)).toEqual([
          0, 1, 2,
        ])
      } finally {
        await runtime.close()
      }
    })
  }, 10_000)
})
