import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsMigrationInventory, createPostgresAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { migratePostgres } from '../src/postgres'

const connectionString = process.env.DATABASE_URL

async function withDatabase(run: (databaseUrl: string) => Promise<void>) {
  const databaseName = `brawltome_primary_${process.pid}_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(connectionString as string)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(connectionString as string)
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

describe.skipIf(!connectionString)('Primary Player PostgreSQL', () => {
  test('migrates linked ownership and preserves non-successful legacy attempts', async () => {
    await withDatabase(async (databaseUrl) => {
      const sql = postgres(databaseUrl, { max: 1 })
      try {
        await sql.unsafe(`
          CREATE TABLE public."user" (
            id uuid PRIMARY KEY,
            created_at timestamp NOT NULL,
            updated_at timestamp NOT NULL
          );
          CREATE TABLE public.player_link (
            user_id uuid PRIMARY KEY REFERENCES public."user"(id),
            brawlhalla_id bigint,
            steam_id varchar(64) NOT NULL,
            linked_via varchar(16) NOT NULL DEFAULT 'steam',
            status varchar(16) NOT NULL,
            linked_at timestamp NOT NULL
          );
          INSERT INTO public."user" VALUES
            ('2f1b5ca7-0c73-4ac8-93ea-a22a663cb295', '2026-08-01', '2026-08-01'),
            ('d6bf157b-9c07-4ce3-9924-a053a28a59bb', '2026-08-02', '2026-08-02'),
            ('7802b6d1-c270-4672-8764-9ba242f94955', '2026-08-03', '2026-08-03'),
            ('b93eea0c-d546-4e85-b47b-6b91db98709d', '2026-08-04', '2026-08-04'),
            ('ba1fbb0e-04fa-49f8-9f2a-e85c7d88298f', '2026-08-05', '2026-08-05'),
            ('e72d7508-25e8-41b5-aee4-a67033fc9d8a', '2026-08-06', '2026-08-06');
          INSERT INTO public.player_link VALUES
            ('2f1b5ca7-0c73-4ac8-93ea-a22a663cb295', 42, 'steam-linked', 'steam', 'linked', '2026-08-05'),
            ('d6bf157b-9c07-4ce3-9924-a053a28a59bb', NULL, 'steam-pending', 'steam', 'pending', '2026-08-06'),
            ('7802b6d1-c270-4672-8764-9ba242f94955', NULL, 'steam-failed', 'steam', 'failed', '2026-08-07'),
            ('b93eea0c-d546-4e85-b47b-6b91db98709d', 42, 'steam-conflict', 'steam', 'conflict', '2026-08-08'),
            ('ba1fbb0e-04fa-49f8-9f2a-e85c7d88298f', 99, 'steam-duplicate-a', 'steam', 'linked', '2026-08-09'),
            ('e72d7508-25e8-41b5-aee4-a67033fc9d8a', 99, 'steam-duplicate-b', 'steam', 'linked', '2026-08-10');
        `)
        await migratePostgres(databaseUrl, accountsMigrationInventory)

        const ownership = await sql`SELECT account_id::text, brawlhalla_id::int FROM accounts.primary_players`
        const attempts = await sql`
          SELECT a.account_id::text, COALESCE(o.status, 'pending') AS status
          FROM accounts.primary_player_verification_attempts a
          LEFT JOIN accounts.primary_player_verification_outcomes o ON o.attempt_id = a.id
          ORDER BY a.started_at
        `
        expect(ownership.map(({ account_id, brawlhalla_id }) => ({ account_id, brawlhalla_id }))).toEqual([
          { account_id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295', brawlhalla_id: 42 },
        ])
        expect(attempts.map(({ status }) => status)).toEqual([
          'verified',
          'pending',
          'failed',
          'conflict',
          'conflict',
          'conflict',
        ])
      } finally {
        await sql.end()
      }
    })
  })

  test('atomically allows only one account to own a player and keeps both attempts', async () => {
    await withDatabase(async (databaseUrl) => {
      await migratePostgres(databaseUrl, accountsMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl)
      const sql = postgres(databaseUrl, { max: 2 })
      try {
        const [firstAccount, secondAccount] = await Promise.all([
          runtime.accounts.signInWithDiscord({ providerAccountId: 'discord-1', displayName: 'One', avatarHash: null }),
          runtime.accounts.signInWithDiscord({ providerAccountId: 'discord-2', displayName: 'Two', avatarHash: null }),
        ])
        const [firstAttempt, secondAttempt] = await Promise.all([
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: firstAccount.account.id,
            steamId: 'steam-1',
            idempotencyKey: 'nonce-1',
          }),
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: secondAccount.account.id,
            steamId: 'steam-2',
            idempotencyKey: 'nonce-2',
          }),
        ])
        const duplicateAttempt = await runtime.accounts.beginPrimaryPlayerVerification({
          accountId: firstAccount.account.id,
          steamId: 'steam-1',
          idempotencyKey: 'nonce-1',
        })
        expect(duplicateAttempt.id).toBe(firstAttempt.id)

        const evidence = {
          brawlhallaId: 42,
          name: 'Ada',
          checkedAt: new Date('2026-08-10T10:01:00.000Z'),
          source: 'brawlhalla-v0-steam-search' as const,
        }
        const resolver = { resolve: async () => evidence }
        const outcomes = await Promise.all([
          runtime.accounts.resolvePrimaryPlayerVerification(firstAttempt.id, resolver),
          runtime.accounts.resolvePrimaryPlayerVerification(secondAttempt.id, resolver),
        ])

        expect(outcomes.map(({ status }) => status).sort()).toEqual(['conflict', 'verified'])
        const replayedOutcomes = await Promise.all([
          runtime.accounts.resolvePrimaryPlayerVerification(firstAttempt.id, resolver),
          runtime.accounts.resolvePrimaryPlayerVerification(secondAttempt.id, resolver),
        ])
        expect(replayedOutcomes).toEqual(outcomes)

        const thirdAccount = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'discord-3',
          displayName: 'Three',
          avatarHash: null,
        })
        const [thirdAttempt, competingAttempt] = await Promise.all([
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: thirdAccount.account.id,
            steamId: 'steam-3a',
            idempotencyKey: 'nonce-3a',
          }),
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: thirdAccount.account.id,
            steamId: 'steam-3b',
            idempotencyKey: 'nonce-3b',
          }),
        ])
        const sameAccountOutcomes = await Promise.all([
          runtime.accounts.resolvePrimaryPlayerVerification(thirdAttempt.id, {
            resolve: async () => ({ ...evidence, brawlhallaId: 100, name: 'Three A' }),
          }),
          runtime.accounts.resolvePrimaryPlayerVerification(competingAttempt.id, {
            resolve: async () => ({ ...evidence, brawlhallaId: 101, name: 'Three B' }),
          }),
        ])
        expect(sameAccountOutcomes.map(({ status }) => status).sort()).toEqual(['conflict', 'verified'])

        const replayedProof = await Promise.allSettled([
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: firstAccount.account.id,
            steamId: 'shared-steam',
            idempotencyKey: 'shared-openid-nonce',
          }),
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: secondAccount.account.id,
            steamId: 'shared-steam',
            idempotencyKey: 'shared-openid-nonce',
          }),
        ])
        expect(replayedProof.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected'])

        const fourthAccount = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'discord-4',
          displayName: 'Four',
          avatarHash: null,
        })
        const pendingAttempt = await runtime.accounts.beginPrimaryPlayerVerification({
          accountId: fourthAccount.account.id,
          steamId: 'steam-4',
          idempotencyKey: 'nonce-4',
        })
        let falseOwnershipError: unknown
        try {
          await sql`
            INSERT INTO accounts.primary_players (
              account_id, brawlhalla_id, player_name, verified_at, verification_attempt_id
            ) VALUES (${fourthAccount.account.id}, 999, 'False owner', now(), ${pendingAttempt.id})
          `
        } catch (error) {
          falseOwnershipError = error
        }
        expect((falseOwnershipError as Error).message).toContain('requires the account')

        const [{ owners, attempts }] = await sql<[{ owners: number; attempts: number }]>`
          SELECT
            (SELECT count(*)::int FROM accounts.primary_players) AS owners,
            (SELECT count(*)::int FROM accounts.primary_player_verification_attempts) AS attempts
        `
        expect({ owners, attempts }).toEqual({ owners: 2, attempts: 6 })
        let immutableError: unknown
        try {
          await sql.unsafe('DELETE FROM accounts.primary_player_verification_attempts WHERE id = $1', [firstAttempt.id])
        } catch (error) {
          immutableError = error
        }
        expect(immutableError).toBeInstanceOf(Error)
        expect((immutableError as Error).message).toContain('immutable')
      } finally {
        await runtime.close()
        await sql.end()
      }
    })
  }, 10_000)
})
