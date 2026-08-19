import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { MAX_PINNED_PLAYERS, accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { migratePostgres } from '../src/postgres'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const hasDedicatedServer = configuredServer?.startsWith(dedicatedServer) ?? false

async function withDatabase(run: (databaseUrl: string) => Promise<void>) {
  if (!hasDedicatedServer) throw new Error('Pinned Players PostgreSQL tests require dedicated 127.0.0.1:55436')

  const databaseName = `brawltome_pinned_players_${process.pid}_${randomUUID().replaceAll('-', '')}`
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

function pinnedIds(
  players: Awaited<ReturnType<ReturnType<typeof createPostgresAccounts>['accounts']['getPinnedPlayers']>>,
) {
  return players.map(({ brawlhallaId }) => brawlhallaId)
}

describe.skipIf(!hasDedicatedServer)('Pinned Players PostgreSQL', () => {
  test('consolidates old saved rows with old pin order first and removes legacy tables', async () => {
    await withDatabase(async (databaseUrl) => {
      const accountId = '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295'
      const legacyAccountId = '3f1b5ca7-0c73-4ac8-93ea-a22a663cb296'
      const seed = postgres(databaseUrl, { max: 1 })
      try {
        await migratePostgres(databaseUrl, accountsMigrationInventory.slice(0, 7))
        await seed`
          INSERT INTO accounts.users (id) VALUES (${accountId}), (${legacyAccountId})
        `
        await seed`
          INSERT INTO accounts.saved_players (account_id, brawlhalla_id, position, saved_at)
          VALUES
            (${accountId}, 101, 0, '2026-08-01T01:00:00Z'),
            (${accountId}, 102, 1, '2026-08-02T01:00:00Z'),
            (${accountId}, 103, 2, '2026-08-03T01:00:00Z'),
            (${accountId}, 104, 3, '2026-08-04T01:00:00Z')
        `
        await seed`
          INSERT INTO accounts.saved_player_pins (account_id, brawlhalla_id, position, pinned_at)
          VALUES
            (${accountId}, 103, 0, '2026-09-03T03:00:00Z'),
            (${accountId}, 101, 1, '2026-09-01T03:00:00Z')
        `
        await seed`
          INSERT INTO accounts.saved_players (account_id, brawlhalla_id, position)
          SELECT ${legacyAccountId}, id, id - 1
          FROM generate_series(201, 221) AS players(id)
        `
      } finally {
        await seed.end()
      }

      expect(await migratePostgres(databaseUrl, accountsMigrationInventory)).toBe(1)
      const runtime = createPostgresAccounts(databaseUrl)
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        const migratedPlayers = await runtime.accounts.getPinnedPlayers(accountId)
        expect(pinnedIds(migratedPlayers)).toEqual([103, 101, 102, 104])
        expect(migratedPlayers.map(({ brawlhallaId, pinnedAt }) => [brawlhallaId, pinnedAt.toISOString()])).toEqual([
          [103, '2026-09-03T03:00:00.000Z'],
          [101, '2026-09-01T03:00:00.000Z'],
          [102, '2026-08-02T01:00:00.000Z'],
          [104, '2026-08-04T01:00:00.000Z'],
        ])
        const legacyIds = Array.from({ length: 21 }, (_, index) => index + 201)
        expect(pinnedIds(await runtime.accounts.getPinnedPlayers(legacyAccountId))).toEqual(legacyIds)
        await expect(runtime.accounts.pinPlayer(legacyAccountId, 222)).rejects.toThrow(
          'Pinned Players cannot exceed 20',
        )
        const reorderedLegacyIds = [...legacyIds].reverse()
        expect(pinnedIds(await runtime.accounts.reorderPinnedPlayers(legacyAccountId, reorderedLegacyIds))).toEqual(
          reorderedLegacyIds,
        )
        const [tables] = await inspect<{ pinned: string | null; saved: string | null; pins: string | null }[]>`
          SELECT
            to_regclass('accounts.pinned_players')::text AS pinned,
            to_regclass('accounts.saved_players')::text AS saved,
            to_regclass('accounts.saved_player_pins')::text AS pins
        `
        expect(tables).toEqual({ pinned: 'accounts.pinned_players', saved: null, pins: null })
      } finally {
        await runtime.close()
        await inspect.end()
      }
    })
  }, 30_000)

  test('does not count a retained Primary Player toward the managed pin cap', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        const { account } = await signIn(runtime, 'pinned-player-cap')
        const primaryBrawlhallaId = 999
        const attemptId = randomUUID()
        await inspect`
          INSERT INTO accounts.primary_player_verification_attempts (
            id, account_id, proof_provider, proof_subject, idempotency_key, started_at
          ) VALUES (${attemptId}, ${account.id}, 'steam', 'primary-test', ${attemptId}, now())
        `
        await inspect`
          INSERT INTO accounts.primary_player_verification_outcomes (
            attempt_id, status, brawlhalla_id, player_name, evidence_source, evidence_checked_at, completed_at
          ) VALUES (${attemptId}, 'verified', ${primaryBrawlhallaId}, 'Primary', 'test', now(), now())
        `
        await inspect`
          INSERT INTO accounts.primary_players (
            account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id
          ) VALUES (${account.id}, ${primaryBrawlhallaId}, 'Primary', now(), ${attemptId})
        `
        await inspect`
          INSERT INTO accounts.pinned_players (account_id, brawlhalla_id, position)
          VALUES (${account.id}, ${primaryBrawlhallaId}, 0)
        `

        expect(await runtime.accounts.pinPlayer(account.id, primaryBrawlhallaId)).toMatchObject({
          brawlhallaId: primaryBrawlhallaId,
        })
        for (let id = 1; id < MAX_PINNED_PLAYERS; id += 1) await runtime.accounts.pinPlayer(account.id, id)
        expect(await runtime.accounts.pinPlayer(account.id, MAX_PINNED_PLAYERS)).toMatchObject({
          brawlhallaId: MAX_PINNED_PLAYERS,
        })
        await expect(runtime.accounts.pinPlayer(account.id, MAX_PINNED_PLAYERS + 1)).rejects.toThrow(
          'Pinned Players cannot exceed 20',
        )
        expect(pinnedIds(await runtime.accounts.getPinnedPlayers(account.id))).toEqual([
          primaryBrawlhallaId,
          ...Array.from({ length: MAX_PINNED_PLAYERS }, (_, index) => index + 1),
        ])
      } finally {
        await runtime.close()
        await inspect.end()
      }
    })
  }, 15_000)

  test('allows idempotent existing pins and legacy-over-cap reorder while capping new additions', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const { account } = await signIn(runtime, 'pinned-player-cap-without-primary')
        for (let id = 1; id <= MAX_PINNED_PLAYERS; id += 1) await runtime.accounts.pinPlayer(account.id, id)

        expect(MAX_PINNED_PLAYERS).toBe(20)
        expect(await runtime.accounts.pinPlayer(account.id, 1)).toMatchObject({ brawlhallaId: 1 })
        await expect(runtime.accounts.pinPlayer(account.id, 21)).rejects.toThrow('Pinned Players cannot exceed 20')
        expect(pinnedIds(await runtime.accounts.getPinnedPlayers(account.id))).toEqual(
          Array.from({ length: 20 }, (_, index) => index + 1),
        )

        const reordered = await runtime.accounts.reorderPinnedPlayers(
          account.id,
          Array.from({ length: 20 }, (_, index) => 20 - index),
        )
        expect(pinnedIds(reordered)).toEqual(Array.from({ length: 20 }, (_, index) => 20 - index))
      } finally {
        await runtime.close()
      }
    })
  }, 15_000)

  test('compacts positions after idempotent unpinning and isolates accounts', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      try {
        const [{ account: first }, { account: second }] = await Promise.all([
          signIn(runtime, 'pinned-player-first'),
          signIn(runtime, 'pinned-player-second'),
        ])
        await Promise.all([41, 42, 43].map((id) => runtime.accounts.pinPlayer(first.id, id)))
        await runtime.accounts.pinPlayer(second.id, 41)

        await Promise.all(Array.from({ length: 8 }, () => runtime.accounts.unpinPlayer(first.id, 42)))
        expect(pinnedIds(await runtime.accounts.getPinnedPlayers(first.id))).toEqual([41, 43])
        expect(pinnedIds(await runtime.accounts.getPinnedPlayers(second.id))).toEqual([41])
        expect((await runtime.accounts.reorderPinnedPlayers(first.id, [43, 41])).map(({ order }) => order)).toEqual([
          0, 1,
        ])
      } finally {
        await runtime.close()
      }
    })
  }, 15_000)
})
