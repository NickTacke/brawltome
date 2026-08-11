import { describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('Accounts migration', () => {
  test('creates one account without orphans and supports a legacy player link after fresh Discord sign-in', async () => {
    const { createPostgresAccounts } = await import('@brawltome/accounts/composition')
    const { globalMigrationInventory } = await import('../src/inventories')
    const { migratePostgres } = await import('../src/postgres')
    const databaseName = `brawltome_accounts_race_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      const legacy = postgres(databaseUrl.toString(), { max: 1 })
      try {
        await legacy.unsafe(`
          CREATE TABLE public."user" (
            id uuid PRIMARY KEY,
            created_at timestamp NOT NULL,
            updated_at timestamp NOT NULL
          );
          CREATE TABLE public.oauth_account (
            provider varchar(32) NOT NULL,
            provider_account_id varchar(64) NOT NULL,
            user_id uuid NOT NULL,
            username varchar(64) NOT NULL,
            avatar_hash varchar(128),
            refresh_token text,
            created_at timestamp NOT NULL,
            updated_at timestamp NOT NULL,
            PRIMARY KEY (provider, provider_account_id)
          );
          CREATE TABLE public.session (
            id varchar(64) PRIMARY KEY,
            user_id uuid NOT NULL,
            expires_at timestamp NOT NULL,
            created_at timestamp NOT NULL
          );
          CREATE TABLE public.player_link (
            user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
            steam_id varchar(64) NOT NULL
          );
        `)
      } finally {
        await legacy.end()
      }

      await migratePostgres(databaseUrl.toString(), globalMigrationInventory)
      const runtime = createPostgresAccounts(databaseUrl.toString())
      let accountId = ''
      try {
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            runtime.accounts.signInWithDiscord({
              providerAccountId: 'discord-race',
              displayName: `Ada ${index}`,
              avatarHash: null,
            }),
          ),
        )
        expect(new Set(results.map(({ account }) => account.id)).size).toBe(1)
        accountId = results[0].account.id

        const conflictingAccountId = 'd6bf157b-9c07-4ce3-9924-a053a28a59bb'
        const conflictingRawToken = 'conflicting-late-v2-token'
        const conflictingSessionId = createHash('sha256').update(conflictingRawToken).digest('hex')
        const legacy = postgres(databaseUrl.toString(), { max: 1 })
        try {
          await legacy.unsafe(`INSERT INTO public."user" VALUES ($1, '2026-08-09 18:42:01', '2026-08-09 18:42:01')`, [
            conflictingAccountId,
          ])
          await legacy.unsafe(
            `INSERT INTO public.oauth_account VALUES ('discord', 'discord-race', $1, 'Conflicting Ada', NULL, NULL, '2026-08-09 18:42:01', '2026-08-09 18:42:01')`,
            [conflictingAccountId],
          )
          await legacy.unsafe(
            `INSERT INTO public.session VALUES ($1, $2, '2099-09-08 18:00:00', '2026-08-09 18:42:01')`,
            [conflictingSessionId, conflictingAccountId],
          )
        } finally {
          await legacy.end()
        }

        expect(await runtime.accounts.authenticate(conflictingRawToken)).toEqual({ status: 'anonymous' })
        expect(await runtime.accounts.authenticate(results[0].sessionToken)).toMatchObject({
          status: 'signedIn',
          account: { id: accountId },
        })
      } finally {
        await runtime.close()
      }

      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        await client`INSERT INTO public.player_link (user_id, steam_id) VALUES (${accountId}, 'steam-fresh')`
        const [{ user_count, identity_count, session_count, legacy_user_count, player_link_count, cutover_count }] =
          await client<
            {
              user_count: number
              identity_count: number
              session_count: number
              legacy_user_count: number
              player_link_count: number
              cutover_count: number
            }[]
          >`
            SELECT
              (SELECT count(*)::int FROM accounts.users) AS user_count,
              (SELECT count(*)::int FROM accounts.oauth_identities) AS identity_count,
              (SELECT count(*)::int FROM accounts.sessions) AS session_count,
              (SELECT count(*)::int FROM public."user" WHERE id = ${accountId}) AS legacy_user_count,
              (SELECT count(*)::int FROM public.player_link WHERE user_id = ${accountId}) AS player_link_count,
              (SELECT count(*)::int FROM accounts.v2_auth_cutover) AS cutover_count
          `
        expect({
          user_count,
          identity_count,
          session_count,
          legacy_user_count,
          player_link_count,
          cutover_count,
        }).toEqual({
          user_count: 1,
          identity_count: 1,
          session_count: 8,
          legacy_user_count: 1,
          player_link_count: 1,
          cutover_count: 0,
        })
        await client`DELETE FROM public.session WHERE user_id = 'd6bf157b-9c07-4ce3-9924-a053a28a59bb'`
        await client`DELETE FROM public.oauth_account WHERE user_id = 'd6bf157b-9c07-4ce3-9924-a053a28a59bb'`
        await client`DELETE FROM public."user" WHERE id = 'd6bf157b-9c07-4ce3-9924-a053a28a59bb'`
      } finally {
        await client.end()
      }

      const concurrentRuntime = createPostgresAccounts(databaseUrl.toString())
      try {
        const signIn = await concurrentRuntime.accounts.signInWithDiscord({
          providerAccountId: 'discord-concurrent',
          displayName: 'Concurrent Ada',
          avatarHash: null,
        })
        expect(await concurrentRuntime.accounts.authenticate(signIn.sessionToken)).toMatchObject({
          status: 'signedIn',
          account: { id: signIn.account.id, displayName: 'Concurrent Ada' },
        })
      } finally {
        await concurrentRuntime.close()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('copies V2 identities and valid sessions as UTC while preserving legacy tables', async () => {
    const { createPostgresAccounts, importLegacyAccounts } = await import('@brawltome/accounts/composition')
    const { globalMigrationInventory } = await import('../src/inventories')
    const { migratePostgres } = await import('../src/postgres')
    const databaseName = `brawltome_accounts_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    await admin.unsafe(`ALTER DATABASE "${databaseName}" SET timezone TO 'America/Los_Angeles'`)
    try {
      const legacy = postgres(databaseUrl.toString(), { max: 1 })
      const accountId = '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295'
      const futureAccountId = 'd6bf157b-9c07-4ce3-9924-a053a28a59bb'
      const rawToken = 'preserved-v2-token'
      const futureRawToken = 'preserved-future-provider-token'
      const sessionId = createHash('sha256').update(rawToken).digest('hex')
      const futureSessionId = createHash('sha256').update(futureRawToken).digest('hex')
      const expiredId = createHash('sha256').update('expired-v2-token').digest('hex')
      const lateRawToken = 'post-migration-v2-token'
      const lateSessionId = createHash('sha256').update(lateRawToken).digest('hex')
      const unreconciledAccountId = '7802b6d1-c270-4672-8764-9ba242f94955'
      const unreconciledRawToken = 'unreconciled-v2-token'
      const unreconciledSessionId = createHash('sha256').update(unreconciledRawToken).digest('hex')
      try {
        await legacy.unsafe(`
          SET TIME ZONE 'America/Los_Angeles';
          CREATE TABLE public."user" (
            id uuid PRIMARY KEY,
            created_at timestamp NOT NULL,
            updated_at timestamp NOT NULL
          );
          CREATE TABLE public.oauth_account (
            provider varchar(32) NOT NULL,
            provider_account_id varchar(64) NOT NULL,
            user_id uuid NOT NULL,
            username varchar(64) NOT NULL,
            avatar_hash varchar(128),
            refresh_token text,
            created_at timestamp NOT NULL,
            updated_at timestamp NOT NULL,
            PRIMARY KEY (provider, provider_account_id)
          );
          CREATE TABLE public.session (
            id varchar(64) PRIMARY KEY,
            user_id uuid NOT NULL,
            expires_at timestamp NOT NULL,
            created_at timestamp NOT NULL
          );
          CREATE TABLE public.player_link (
            user_id uuid PRIMARY KEY,
            brawlhalla_id integer,
            steam_id varchar(64) NOT NULL,
            linked_via varchar(32) NOT NULL,
            status varchar(16) NOT NULL,
            linked_at timestamp NOT NULL
          );
        `)
        await legacy.unsafe(
          `INSERT INTO public."user" VALUES
             ($1, '2026-08-09 18:42:01', '2026-08-09 18:42:02'),
             ($2, '2026-08-09 19:42:01', '2026-08-09 19:42:02')`,
          [accountId, futureAccountId],
        )
        await legacy.unsafe(
          `INSERT INTO public.oauth_account VALUES ('discord', 'discord-42', $1, 'Ada', 'avatar', 'private-refresh', '2026-08-09 18:42:03', '2026-08-09 18:42:04')`,
          [accountId],
        )
        await legacy.unsafe(
          `INSERT INTO public.oauth_account VALUES ('future-provider', 'future-42', $1, 'Ada elsewhere', NULL, NULL, '2026-08-09 18:42:03', '2026-08-09 18:42:04')`,
          [accountId],
        )
        await legacy.unsafe(
          `INSERT INTO public.oauth_account VALUES ('future-provider', 'future-only', $1, 'Future Ada', 'not-discord', NULL, '2026-08-09 19:42:03', '2026-08-09 19:42:04')`,
          [futureAccountId],
        )
        await legacy.unsafe(
          `INSERT INTO public.session VALUES
             ($1, $2, '2099-09-08 18:00:00', '2026-08-09 18:00:00'),
             ($3, $2, '2020-01-01 00:00:00', '2019-12-01 00:00:00'),
             ($4, $5, '2099-09-08 19:00:00', '2026-08-09 19:00:00')`,
          [sessionId, accountId, expiredId, futureSessionId, futureAccountId],
        )
      } finally {
        await legacy.end()
      }

      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(
        globalMigrationInventory.length,
      )
      expect(await migratePostgres(databaseUrl.toString(), globalMigrationInventory)).toBe(0)

      const lateLegacy = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const [databaseSession] = await lateLegacy<{ timezone: string }[]>`
          SELECT current_setting('TimeZone') AS timezone
        `
        expect(databaseSession.timezone).toBe('America/Los_Angeles')
        await lateLegacy.unsafe(`UPDATE public."user" SET updated_at = '2026-08-10 03:04:06.456' WHERE id = $1`, [
          accountId,
        ])
        await lateLegacy.unsafe(
          `UPDATE public.oauth_account
           SET username = 'Late Ada',
               avatar_hash = 'late-avatar',
               refresh_token = 'late-discord-refresh',
               created_at = '2026-08-10 03:04:07.123',
               updated_at = '2026-08-10 03:04:08.456'
           WHERE provider = 'discord' AND provider_account_id = 'discord-42'`,
        )
        await lateLegacy.unsafe(
          `UPDATE public.oauth_account
           SET username = 'Late elsewhere',
               avatar_hash = 'future-avatar',
               refresh_token = 'late-future-refresh',
               created_at = '2026-08-10 03:04:09.123',
               updated_at = '2026-08-10 03:04:10.456'
           WHERE provider = 'future-provider' AND provider_account_id = 'future-42'`,
        )
        await lateLegacy.unsafe(
          `INSERT INTO public.session VALUES ($1, $2, '2099-10-11 12:13:14.789', '2026-08-10 03:04:11.789')`,
          [lateSessionId, accountId],
        )
        await lateLegacy.unsafe(`INSERT INTO public."user" VALUES ($1, '2026-08-10 04:00:00', '2026-08-10 04:00:01')`, [
          unreconciledAccountId,
        ])
        await lateLegacy.unsafe(
          `INSERT INTO public.oauth_account VALUES ('discord', 'discord-unreconciled', $1, 'Unreconciled Ada', NULL, NULL, '2026-08-10 04:00:02', '2026-08-10 04:00:03')`,
          [unreconciledAccountId],
        )
        await lateLegacy.unsafe(
          `INSERT INTO public.session VALUES ($1, $2, '2099-10-11 13:00:00', '2026-08-10 04:00:04')`,
          [unreconciledSessionId, unreconciledAccountId],
        )
      } finally {
        await lateLegacy.end()
      }

      const client = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const users = await client`SELECT id, created_at FROM accounts.users`
        const identities =
          await client`SELECT provider, provider_account_id, refresh_token FROM accounts.oauth_identities ORDER BY provider`
        const sessions = await client`SELECT id, expires_at, created_at FROM accounts.sessions`
        const [legacyTables] = await client`
          SELECT to_regclass('public.user') IS NOT NULL AS has_user,
                 to_regclass('public.oauth_account') IS NOT NULL AS has_oauth,
                 to_regclass('public.session') IS NOT NULL AS has_session
        `

        expect(users).toHaveLength(2)
        expect(users.find(({ id }) => id === accountId)?.created_at.toISOString()).toBe('2026-08-09T18:42:01.000Z')
        expect(identities).toHaveLength(3)
        expect(identities.map(({ provider }) => provider)).toEqual(['discord', 'future-provider', 'future-provider'])
        expect(identities[0].refresh_token).toBe('private-refresh')
        expect(sessions).toHaveLength(2)
        expect(sessions.map(({ id }) => id)).toContain(sessionId)
        expect(sessions.find(({ id }) => id === sessionId)?.created_at.toISOString()).toBe('2026-08-09T18:00:00.000Z')
        expect(legacyTables).toEqual({ has_user: true, has_oauth: true, has_session: true })
      } finally {
        await client.end()
      }

      const runtime = createPostgresAccounts(databaseUrl.toString())
      try {
        const authenticated = await runtime.accounts.authenticate(rawToken)
        expect(authenticated.status).toBe('signedIn')
        if (authenticated.status !== 'signedIn') throw new Error('Expected migrated session to authenticate')
        expect(authenticated.account).toMatchObject({ id: accountId, displayName: 'Ada' })

        const futureAuthenticated = await runtime.accounts.authenticate(futureRawToken)
        expect(futureAuthenticated.status).toBe('signedIn')
        if (futureAuthenticated.status !== 'signedIn') throw new Error('Expected future provider session')
        expect(futureAuthenticated.account).toMatchObject({
          id: futureAccountId,
          displayName: 'Future Ada',
          avatarUrl: null,
        })

        const lateAuthenticated = await runtime.accounts.authenticate(lateRawToken)
        expect(lateAuthenticated.status).toBe('signedIn')
        if (lateAuthenticated.status !== 'signedIn') throw new Error('Expected post-migration V2 session')
        expect(lateAuthenticated.account).toMatchObject({
          id: accountId,
          displayName: 'Late Ada',
          avatarUrl: 'https://cdn.discordapp.com/avatars/discord-42/late-avatar.png',
        })
        expect((await runtime.accounts.authenticate(lateRawToken)).status).toBe('signedIn')
      } finally {
        await runtime.close()
      }

      const imported = postgres(databaseUrl.toString(), { max: 1 })
      try {
        const [user] = await imported`
          SELECT id, created_at, updated_at FROM accounts.users WHERE id = ${accountId}
        `
        const identities = await imported<
          {
            provider: string
            provider_account_id: string
            account_id: string
            display_name: string
            avatar_hash: string | null
            refresh_token: string | null
            created_at: Date
            updated_at: Date
          }[]
        >`
          SELECT provider, provider_account_id, account_id, display_name, avatar_hash, refresh_token,
                 created_at, updated_at
          FROM accounts.oauth_identities
          WHERE account_id = ${accountId}
          ORDER BY provider
        `
        const [session] = await imported`
          SELECT id, account_id, expires_at, created_at
          FROM accounts.sessions
          WHERE id = ${lateSessionId}
        `

        expect({
          id: user.id,
          createdAt: user.created_at.toISOString(),
          updatedAt: user.updated_at.toISOString(),
        }).toEqual({
          id: accountId,
          createdAt: '2026-08-09T18:42:01.000Z',
          updatedAt: '2026-08-10T03:04:06.456Z',
        })
        expect(
          identities.map((identity) => ({
            ...identity,
            created_at: identity.created_at.toISOString(),
            updated_at: identity.updated_at.toISOString(),
          })),
        ).toEqual([
          {
            provider: 'discord',
            provider_account_id: 'discord-42',
            account_id: accountId,
            display_name: 'Late Ada',
            avatar_hash: 'late-avatar',
            refresh_token: 'late-discord-refresh',
            created_at: '2026-08-10T03:04:07.123Z',
            updated_at: '2026-08-10T03:04:08.456Z',
          },
          {
            provider: 'future-provider',
            provider_account_id: 'future-42',
            account_id: accountId,
            display_name: 'Late elsewhere',
            avatar_hash: 'future-avatar',
            refresh_token: 'late-future-refresh',
            created_at: '2026-08-10T03:04:09.123Z',
            updated_at: '2026-08-10T03:04:10.456Z',
          },
        ])
        expect({
          id: session.id,
          accountId: session.account_id,
          expiresAt: session.expires_at.toISOString(),
          createdAt: session.created_at.toISOString(),
        }).toEqual({
          id: lateSessionId,
          accountId: accountId,
          expiresAt: '2099-10-11T12:13:14.789Z',
          createdAt: '2026-08-10T03:04:11.789Z',
        })
      } finally {
        await imported.end()
      }

      const revocationRuntime = createPostgresAccounts(databaseUrl.toString())
      try {
        await revocationRuntime.accounts.signOut(rawToken)
        expect(await revocationRuntime.accounts.authenticate(rawToken)).toEqual({ status: 'anonymous' })

        const legacy = postgres(databaseUrl.toString(), { max: 1 })
        try {
          await legacy`DELETE FROM public.session WHERE id = ${futureSessionId}`
          const [{ unreconciled_count }] = await legacy<{ unreconciled_count: number }[]>`
            SELECT count(*)::int AS unreconciled_count
            FROM accounts.sessions
            WHERE id = ${unreconciledSessionId}
          `
          expect(unreconciled_count).toBe(0)
        } finally {
          await legacy.end()
        }

        await expect(
          importLegacyAccounts(databaseUrl.toString(), { legacyWritersQuiesced: false } as never),
        ).rejects.toThrow('Legacy Accounts writers must be quiescent')
        expect(await revocationRuntime.accounts.authenticate(lateRawToken)).toMatchObject({ status: 'signedIn' })

        const finalization = await importLegacyAccounts(databaseUrl.toString(), { legacyWritersQuiesced: true })
        expect(finalization).toMatchObject({ status: 'complete', reconciliation: { exact: true } })
        expect(await revocationRuntime.accounts.authenticate(futureRawToken)).toEqual({ status: 'anonymous' })

        const retirement = postgres(databaseUrl.toString(), { max: 1 })
        try {
          const [beforeRetirement] = await retirement<
            {
              imported_from_v2: boolean
              legacy_session_count: number
              unreconciled_session_count: number
              revoked_session_count: number
              display_name: string
            }[]
          >`
            SELECT imported_from_v2,
                   (SELECT count(*)::int FROM public.session WHERE id = ${lateSessionId}) AS legacy_session_count,
                   (SELECT count(*)::int FROM accounts.sessions WHERE id = ${unreconciledSessionId}) AS unreconciled_session_count,
                   (SELECT count(*)::int FROM accounts.sessions WHERE id = ${futureSessionId}) AS revoked_session_count,
                   (SELECT display_name FROM accounts.oauth_identities WHERE provider = 'discord' AND provider_account_id = 'discord-42') AS display_name
            FROM accounts.sessions
            WHERE id = ${lateSessionId}
          `
          expect(beforeRetirement).toEqual({
            imported_from_v2: false,
            legacy_session_count: 1,
            unreconciled_session_count: 1,
            revoked_session_count: 0,
            display_name: 'Late Ada',
          })
          await retirement.unsafe('DROP TABLE public.session')
        } finally {
          await retirement.end()
        }

        expect(await revocationRuntime.accounts.authenticate(lateRawToken)).toMatchObject({
          status: 'signedIn',
          account: { displayName: 'Late Ada' },
        })
        expect(await revocationRuntime.accounts.authenticate(unreconciledRawToken)).toMatchObject({
          status: 'signedIn',
          account: { id: unreconciledAccountId, displayName: 'Unreconciled Ada' },
        })
        const canonical = postgres(databaseUrl.toString(), { max: 1 })
        try {
          const [{ session_count }] = await canonical<{ session_count: number }[]>`
            SELECT count(*)::int AS session_count
            FROM accounts.sessions
            WHERE id = ${lateSessionId}
          `
          expect(session_count).toBe(1)
        } finally {
          await canonical.end()
        }
      } finally {
        await revocationRuntime.close()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)

  test('round-trips launch preferences across sessions and runtimes without anonymous persistence', async () => {
    const { createPostgresAccounts } = await import('@brawltome/accounts/composition')
    const defaultPreferences = { version: 1, leaderboardBracket: '1v1', leaderboardRegion: 'all' } as const
    const { globalMigrationInventory } = await import('../src/inventories')
    const { migratePostgres } = await import('../src/postgres')
    const databaseName = `brawltome_preferences_${process.pid}_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(connectionString as string)
    adminUrl.pathname = '/postgres'
    const databaseUrl = new URL(connectionString as string)
    databaseUrl.pathname = `/${databaseName}`
    const admin = postgres(adminUrl.toString(), { max: 1 })

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
    try {
      await migratePostgres(databaseUrl.toString(), globalMigrationInventory)
      const firstRuntime = createPostgresAccounts(databaseUrl.toString())
      let accountId = ''
      let secondDeviceToken = ''
      try {
        expect(await firstRuntime.accounts.getPreferences(null)).toEqual(defaultPreferences)
        const anonymousClient = postgres(databaseUrl.toString(), { max: 1 })
        try {
          const [{ preference_count }] = await anonymousClient<{ preference_count: number }[]>`
            SELECT count(*)::int AS preference_count FROM accounts.preferences
          `
          expect(preference_count).toBe(0)
        } finally {
          await anonymousClient.end()
        }

        const firstDevice = await firstRuntime.accounts.signInWithDiscord({
          providerAccountId: 'discord-preferences',
          displayName: 'Ada',
          avatarHash: null,
        })
        const secondDevice = await firstRuntime.accounts.signInWithDiscord({
          providerAccountId: 'discord-preferences',
          displayName: 'Ada',
          avatarHash: null,
        })
        accountId = firstDevice.account.id
        secondDeviceToken = secondDevice.sessionToken

        await firstRuntime.accounts.updatePreferences(accountId, {
          version: 1,
          leaderboardBracket: 'solo2v2',
          leaderboardRegion: 'EU',
        })
      } finally {
        await firstRuntime.close()
      }

      const secondRuntime = createPostgresAccounts(databaseUrl.toString())
      try {
        const authentication = await secondRuntime.accounts.authenticate(secondDeviceToken)
        expect(authentication).toMatchObject({ status: 'signedIn', account: { id: accountId } })
        expect(await secondRuntime.accounts.getPreferences(accountId)).toEqual({
          version: 1,
          leaderboardBracket: 'solo2v2',
          leaderboardRegion: 'EU',
        })

        const otherAccount = await secondRuntime.accounts.signInWithDiscord({
          providerAccountId: 'discord-other-preferences',
          displayName: 'Grace',
          avatarHash: null,
        })
        expect(otherAccount.account.id).not.toBe(accountId)
        expect(await secondRuntime.accounts.getPreferences(otherAccount.account.id)).toEqual(defaultPreferences)

        const client = postgres(databaseUrl.toString(), { max: 1 })
        try {
          const [stored] = await client<
            { schema_version: number; leaderboard_bracket: string; leaderboard_region: string }[]
          >`
            SELECT schema_version, leaderboard_bracket, leaderboard_region
            FROM accounts.preferences
            WHERE account_id = ${accountId}
          `
          expect(stored).toEqual({
            schema_version: 1,
            leaderboard_bracket: 'solo2v2',
            leaderboard_region: 'EU',
          })

          await client`
            UPDATE accounts.preferences
            SET schema_version = 2,
                leaderboard_bracket = '3v3',
                leaderboard_region = 'JPN'
            WHERE account_id = ${accountId}
          `
        } finally {
          await client.end()
        }

        expect(await secondRuntime.accounts.getPreferences(accountId)).toEqual(defaultPreferences)
      } finally {
        await secondRuntime.close()
      }
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      await admin.end()
    }
  }, 15_000)
})
