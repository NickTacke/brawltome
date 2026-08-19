import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { AccountsMaintenanceError, createPostgresAccounts, importLegacyAccounts } from '@brawltome/accounts/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { migratePostgres } from '../src/postgres'
import {
  legacyAccountIds,
  legacyAccountSecrets,
  legacyAccountsRowsSql,
  legacyAccountsSchemaSql,
} from './fixtures/legacy-accounts'

const configuredServer = process.env.DATABASE_URL
const destructiveDatabaseTestsEnabled = process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS === 'true'
const describePostgres = configuredServer && destructiveDatabaseTestsEnabled ? describe : describe.skip
const requiredEvidenceTriggers = [
  ['accounts.legacy_archive', 'accounts_legacy_archive_immutable'],
  ['accounts.legacy_archive', 'accounts_legacy_archive_prevent_truncate'],
  ['accounts.legacy_import_ledger', 'accounts_legacy_import_ledger_immutable'],
  ['accounts.legacy_import_ledger', 'accounts_legacy_import_ledger_prevent_truncate'],
  ['accounts.legacy_import_rejections', 'accounts_legacy_import_rejections_immutable'],
  ['accounts.legacy_import_rejections', 'accounts_legacy_import_rejections_prevent_truncate'],
  ['accounts.legacy_import_audit_events', 'accounts_legacy_import_audit_immutable'],
  ['accounts.legacy_import_audit_events', 'accounts_legacy_import_audit_prevent_truncate'],
  ['accounts.primary_player_verification_attempts', 'primary_player_attempts_immutable'],
  ['accounts.primary_player_verification_attempts', 'accounts_primary_attempts_prevent_truncate'],
  ['accounts.primary_player_verification_outcomes', 'primary_player_outcomes_immutable'],
  ['accounts.primary_player_verification_outcomes', 'accounts_primary_outcomes_prevent_truncate'],
] as const
let databaseServer: URL
let admin: ReturnType<typeof postgres>

beforeAll(async () => {
  if (!configuredServer || !destructiveDatabaseTestsEnabled) return
  databaseServer = new URL(configuredServer)
  if (!['127.0.0.1', 'localhost'].includes(databaseServer.hostname)) {
    throw new Error('Accounts migration tests require a loopback PostgreSQL DATABASE_URL')
  }

  const adminUrl = new URL(databaseServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin`SELECT 1`
})

afterAll(async () => {
  await admin?.end()
})

async function withFixtureDatabase(run: (databaseUrl: string) => Promise<void>): Promise<void> {
  const databaseName = `bt_224_case_${process.pid}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(databaseServer)
  databaseUrl.pathname = `/${databaseName}`
  const connection = databaseUrl.toString()
  const setup = postgres(connection, { max: 1 })
  try {
    await setup.unsafe(legacyAccountsSchemaSql)
    await setup.unsafe(legacyAccountsRowsSql)
    await migratePostgres(connection, globalMigrationInventory)
    await run(connection)
  } finally {
    await setup.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  }
}

async function waitForImportWriterFence(probe: ReturnType<typeof postgres>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const [lock] = await probe.unsafe<Array<{ acquired: boolean }>>(
      "SELECT pg_try_advisory_lock_shared(hashtextextended('accounts:writer-maintenance-fence', 0)) AS acquired",
    )
    if (!lock.acquired) return
    await probe.unsafe("SELECT pg_advisory_unlock_shared(hashtextextended('accounts:writer-maintenance-fence', 0))")
    await Bun.sleep(10)
  }
  throw new Error('Accounts import did not acquire the writer maintenance fence')
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

async function runFullRehearsal() {
  let evidence: unknown
  await withFixtureDatabase(async (databaseUrl) => {
    const result = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
    const runtime = createPostgresAccounts(databaseUrl)
    const inspect = postgres(databaseUrl, { max: 1 })
    try {
      const authenticated = await runtime.accounts.authenticate(legacyAccountSecrets.validRawSessionToken)
      const identities = await inspect<
        Array<{
          provider: string
          provider_account_id: string
          account_id: string
          display_name: string
          avatar_hash: string | null
          refresh_token: string | null
          created_at: Date
          updated_at: Date
        }>
      >`
        SELECT provider, provider_account_id, account_id::text, display_name, avatar_hash, refresh_token,
               created_at, updated_at
        FROM accounts.oauth_identities
        WHERE account_id = ${legacyAccountIds.linked}
        ORDER BY provider
      `
      const attempts = await inspect<Array<{ status: string; count: number }>>`
        SELECT COALESCE(outcome.status, 'pending') AS status, count(*)::integer AS count
        FROM accounts.primary_player_verification_attempts attempt
        LEFT JOIN accounts.primary_player_verification_outcomes outcome ON outcome.attempt_id = attempt.id
        GROUP BY COALESCE(outcome.status, 'pending')
        ORDER BY status
      `
      const primary = await inspect<Array<{ account_id: string; brawlhalla_id: number }>>`
        SELECT account_id::text, brawlhalla_id::integer FROM accounts.primary_players ORDER BY account_id
      `
      const [personalization] = await inspect<Array<{ preferences: number; pinned_players: number; pins: number }>>`
        SELECT
          (SELECT count(*)::integer FROM accounts.preferences) AS preferences,
          (SELECT count(*)::integer FROM accounts.pinned_players) AS pinned_players,
          0::integer AS pins
      `
      const history = await inspect<Array<{ identity: string }>>`
        SELECT identity FROM brawltome_migrations.history ORDER BY ordinal
      `
      const [cutover] = await inspect<Array<{ finalized: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM accounts.v2_auth_cutover WHERE singleton) AS finalized
      `
      await inspect.unsafe('DROP TABLE public.player_link, public.session, public.oauth_account, public."user"')
      const authenticatedAfterRetirement = await runtime.accounts.authenticate(
        legacyAccountSecrets.validRawSessionToken,
      )

      evidence = {
        result,
        authenticated,
        authenticatedAfterRetirement,
        identities: identities.map((identity) => ({
          ...identity,
          created_at: identity.created_at.toISOString(),
          updated_at: identity.updated_at.toISOString(),
        })),
        attempts,
        primary,
        personalization,
        history: history.map(({ identity }) => identity),
        cutover,
      }
    } finally {
      await runtime.close()
      await inspect.end()
    }
  })
  return evidence
}

describePostgres('Accounts V2 import', () => {
  test('produces identical complete evidence in two consecutive full-plan rehearsals', async () => {
    const first = await runFullRehearsal()
    const second = await runFullRehearsal()
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      result: {
        status: 'complete',
        checkpoint: null,
        reconciliation: { exact: true, semanticExact: true, preservedAttempts: 9 },
      },
      authenticated: {
        status: 'signedIn',
        account: { id: legacyAccountIds.linked },
      },
      authenticatedAfterRetirement: {
        status: 'signedIn',
        account: { id: legacyAccountIds.linked },
      },
      attempts: [
        { status: 'conflict', count: 4 },
        { status: 'failed', count: 2 },
        { status: 'pending', count: 2 },
        { status: 'verified', count: 1 },
      ],
      primary: [{ account_id: legacyAccountIds.linked, brawlhalla_id: 42 }],
      personalization: { preferences: 0, pinned_players: 0, pins: 0 },
      history: globalMigrationInventory.map(({ identity }) => identity),
      cutover: { finalized: true },
    })
  }, 60_000)

  test('preserves recognized nullable-link attempts and conservative contradictory-field provenance', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
        reconciliation: { exact: true, preservedAttempts: 9 },
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        const rows = await inspect<
          Array<{
            account_id: string
            proof_subject: string
            status: string
            brawlhalla_id: number | null
            evidence_source: string | null
            evidence_checked_at: Date | null
            archived_brawlhalla_id: number
            ledger_outcome: string
          }>
        >`
          SELECT
            attempt.account_id::text,
            attempt.proof_subject,
            COALESCE(outcome.status, 'pending') AS status,
            outcome.brawlhalla_id::integer,
            outcome.evidence_source,
            outcome.evidence_checked_at,
            (archive.raw_row->>'brawlhalla_id')::integer AS archived_brawlhalla_id,
            ledger.outcome AS ledger_outcome
          FROM accounts.primary_player_verification_attempts attempt
          LEFT JOIN accounts.primary_player_verification_outcomes outcome ON outcome.attempt_id = attempt.id
          JOIN accounts.legacy_archive archive
            ON archive.source_table = 'player_link' AND archive.source_key = attempt.account_id::text
          JOIN accounts.legacy_import_ledger ledger
            ON ledger.source_table = archive.source_table AND ledger.source_key = archive.source_key
          WHERE attempt.account_id IN (
            ${legacyAccountIds.pendingWithPlayerId},
            ${legacyAccountIds.failedWithPlayerId},
            ${legacyAccountIds.conflictWithPlayerId}
          )
        `
        const byAccount = Object.fromEntries(rows.map((row) => [row.account_id, row]))
        expect(byAccount[legacyAccountIds.pendingWithPlayerId]).toMatchObject({
          proof_subject: 'fixture-steam-pending-with-id',
          status: 'pending',
          brawlhalla_id: null,
          evidence_source: null,
          evidence_checked_at: null,
          archived_brawlhalla_id: 31337,
          ledger_outcome: 'transformed',
        })
        expect(byAccount[legacyAccountIds.failedWithPlayerId]).toMatchObject({
          proof_subject: 'fixture-steam-failed-with-id',
          status: 'failed',
          brawlhalla_id: null,
          evidence_source: null,
          evidence_checked_at: null,
          archived_brawlhalla_id: 31338,
          ledger_outcome: 'transformed',
        })
        expect(byAccount[legacyAccountIds.conflictWithPlayerId]).toMatchObject({
          proof_subject: 'fixture-steam-conflict-with-id',
          status: 'conflict',
          brawlhalla_id: 31339,
          evidence_source: 'legacy-steam-link',
          evidence_checked_at: new Date('2026-08-13T10:00:00.000Z'),
          archived_brawlhalla_id: 31339,
          ledger_outcome: 'transformed',
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('resumes, serializes concurrent imports, preserves exact auth, and redacts archived secrets', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const seed = postgres(databaseUrl, { max: 1 })
      try {
        await seed`
          INSERT INTO accounts.preferences (account_id, schema_version, leaderboard_bracket, leaderboard_region)
          VALUES (${legacyAccountIds.linked}, 1, '2v2', 'EU')
        `
        await seed`
          INSERT INTO accounts.pinned_players (account_id, brawlhalla_id, position)
          VALUES (${legacyAccountIds.linked}, 77, 0)
        `
      } finally {
        await seed.end()
      }

      const first = await importLegacyAccounts(databaseUrl, {
        legacyWritersQuiesced: true,
        batchSize: 1,
        maxBatches: 1,
      })
      expect(first.status).toBe('in-progress')
      expect(first.checkpoint).not.toBeNull()

      const [completed, concurrent] = await Promise.all([
        importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true, batchSize: 1 }),
        importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true, batchSize: 1 }),
      ])
      expect(completed.status).toBe('complete')
      expect(concurrent).toEqual(completed)
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toEqual(completed)

      const runtime = createPostgresAccounts(databaseUrl)
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        expect(await runtime.accounts.authenticate(legacyAccountSecrets.validRawSessionToken)).toMatchObject({
          status: 'signedIn',
          account: { id: legacyAccountIds.linked },
        })
        expect(await runtime.accounts.authenticate(legacyAccountSecrets.expiredRawSessionToken)).toEqual({
          status: 'anonymous',
        })

        const [oauth] = await inspect<
          Array<{
            raw_row: Record<string, unknown>
            secret_evidence: Record<string, unknown>
            source_row_checksum: string
            content_checksum: string
          }>
        >`
          SELECT raw_row, secret_evidence, source_row_checksum, content_checksum
          FROM accounts.legacy_archive
          WHERE source_table = 'oauth_account' AND source_key = '["future-provider", "future-linked"]'
        `
        expect(oauth.raw_row.refresh_token).toBe('[REDACTED]')
        expect(oauth.secret_evidence).toMatchObject({ refreshTokenPresent: true })
        expect(oauth.secret_evidence.refreshTokenSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(oauth.source_row_checksum).toMatch(/^[0-9a-f]{64}$/)
        expect(oauth.content_checksum).toMatch(/^[0-9a-f]{64}$/)
        expect(JSON.stringify(completed)).not.toContain(legacyAccountSecrets.opaqueRefreshToken)
        expect(JSON.stringify(completed)).not.toContain(legacyAccountSecrets.linkedSteamId)
        const evidenceRows = await inspect<Array<{ evidence: string }>>`
          SELECT raw_row::text || secret_evidence::text AS evidence FROM accounts.legacy_archive
          UNION ALL
          SELECT jsonb_build_object(
            'sourceTable', source_table,
            'sourceKey', source_key,
            'outcome', outcome,
            'destinationKind', destination_kind,
            'destinationKey', destination_key
          )::text FROM accounts.legacy_import_ledger
          UNION ALL
          SELECT evidence::text FROM accounts.legacy_import_rejections
          UNION ALL
          SELECT evidence::text FROM accounts.legacy_import_audit_events
        `
        const serializedEvidence = evidenceRows.map(({ evidence }) => evidence).join('\n')
        expect(serializedEvidence).not.toContain(legacyAccountSecrets.opaqueRefreshToken)
        expect(serializedEvidence).not.toContain(legacyAccountSecrets.linkedSteamId)
        expect(serializedEvidence).not.toContain('fixture-steam-')
        expect(serializedEvidence).not.toContain('fixture-valid-v2-session-token')

        const [identity] = await inspect<Array<{ refresh_token: string }>>`
          SELECT refresh_token FROM accounts.oauth_identities
          WHERE provider = 'future-provider' AND provider_account_id = 'future-linked'
        `
        expect(identity.refresh_token).toBe(legacyAccountSecrets.opaqueRefreshToken)
        const [personalization] = await inspect<Array<{ preferences: number; saved: number; pins: number }>>`
          SELECT
            (SELECT count(*)::integer FROM accounts.preferences WHERE account_id = ${legacyAccountIds.linked}) AS preferences,
            (SELECT count(*)::integer FROM accounts.pinned_players WHERE account_id = ${legacyAccountIds.linked}) AS saved,
            (SELECT count(*)::integer FROM accounts.pinned_players WHERE account_id = ${legacyAccountIds.linked}) AS pins
        `
        expect(personalization).toEqual({ preferences: 1, saved: 1, pins: 1 })

        const immutableEvidenceTables = [
          ['accounts.legacy_archive', 'raw_row'],
          ['accounts.legacy_import_ledger', 'outcome'],
          ['accounts.legacy_import_rejections', 'evidence'],
          ['accounts.legacy_import_audit_events', 'evidence'],
        ] as const
        for (const [table, column] of immutableEvidenceTables) {
          await expect(Promise.resolve(inspect.unsafe(`UPDATE ${table} SET ${column} = ${column}`))).rejects.toThrow(
            'immutable',
          )
          await expect(Promise.resolve(inspect.unsafe(`DELETE FROM ${table}`))).rejects.toThrow('immutable')
          await expect(Promise.resolve(inspect.unsafe(`TRUNCATE ${table} CASCADE`))).rejects.toThrow('immutable')
        }
        for (const [table, column] of [
          ['accounts.primary_player_verification_attempts', 'proof_subject'],
          ['accounts.primary_player_verification_outcomes', 'status'],
        ] as const) {
          await expect(Promise.resolve(inspect.unsafe(`UPDATE ${table} SET ${column} = ${column}`))).rejects.toThrow(
            'immutable',
          )
          await expect(Promise.resolve(inspect.unsafe(`DELETE FROM ${table}`))).rejects.toThrow('immutable')
          await expect(Promise.resolve(inspect.unsafe(`TRUNCATE ${table} CASCADE`))).rejects.toThrow('immutable')
        }
      } finally {
        await runtime.close()
        await inspect.end()
      }
    })
  }, 30_000)

  test('fences runtime destination writers across existing PostgreSQL runtimes', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const fence = postgres(databaseUrl, { max: 1 })
      const inspect = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let settled = 0
      let fenceHeld = false
      let writers: Array<Promise<unknown>> = []
      try {
        await fence.unsafe("SELECT pg_advisory_lock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        fenceHeld = true
        writers = [
          runtime.accounts.updatePreferences(legacyAccountIds.linked, {
            version: 1,
            leaderboardBracket: '2v2',
            leaderboardRegion: 'EU',
          }),
          runtime.accounts.signInWithDiscord({
            providerAccountId: 'fenced-discord-writer',
            displayName: 'Fenced writer',
            avatarHash: null,
          }),
          runtime.accounts.beginPrimaryPlayerVerification({
            accountId: legacyAccountIds.linked,
            steamId: 'fenced-steam-writer',
            idempotencyKey: 'fenced-writer-attempt',
          }),
          runtime.accounts.pinPlayer(legacyAccountIds.linked, 424242),
          runtime.accounts.authenticate(legacyAccountSecrets.validRawSessionToken),
        ].map((writer) =>
          writer.finally(() => {
            settled += 1
          }),
        )
        await waitForAdvisoryWaiters(inspect, 'ShareLock', writers.length)
        expect(settled).toBe(0)
        const [duringFence] = await inspect<
          Array<{ preferences: number; saved: number; attempts: number; identities: number }>
        >`
          SELECT
            (SELECT count(*)::integer FROM accounts.preferences) AS preferences,
            (SELECT count(*)::integer FROM accounts.pinned_players) AS saved,
            (SELECT count(*)::integer FROM accounts.primary_player_verification_attempts) AS attempts,
            (SELECT count(*)::integer FROM accounts.oauth_identities
             WHERE provider_account_id = 'fenced-discord-writer') AS identities
        `
        expect(duringFence).toEqual({ preferences: 0, saved: 0, attempts: 9, identities: 0 })

        await fence.unsafe("SELECT pg_advisory_unlock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        fenceHeld = false
        await Promise.all(writers)
        const [afterFence] = await inspect<
          Array<{ preferences: number; saved: number; attempts: number; identities: number }>
        >`
          SELECT
            (SELECT count(*)::integer FROM accounts.preferences) AS preferences,
            (SELECT count(*)::integer FROM accounts.pinned_players) AS saved,
            (SELECT count(*)::integer FROM accounts.primary_player_verification_attempts) AS attempts,
            (SELECT count(*)::integer FROM accounts.oauth_identities
             WHERE provider_account_id = 'fenced-discord-writer') AS identities
        `
        expect(afterFence).toEqual({ preferences: 1, saved: 1, attempts: 10, identities: 1 })
      } finally {
        if (fenceHeld) {
          await fence.unsafe("SELECT pg_advisory_unlock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        }
        await Promise.allSettled(writers)
        await runtime.close()
        await inspect.end()
        await fence.end()
      }
    })
  }, 15_000)

  test('fences every remaining public Accounts mutation seam', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const fence = postgres(databaseUrl, { max: 1 })
      const inspect = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let fenceHeld = false
      let writers: Array<Promise<unknown>> = []
      try {
        const signIn = await runtime.accounts.signInWithDiscord({
          providerAccountId: 'fenced-signout-session',
          displayName: 'Fenced signout',
          avatarHash: null,
        })
        const attempt = await runtime.accounts.beginPrimaryPlayerVerification({
          accountId: legacyAccountIds.pending,
          steamId: 'fenced-completion-steam',
          idempotencyKey: 'fenced-completion-attempt',
        })
        await runtime.accounts.pinPlayer(legacyAccountIds.pending, 501)
        await runtime.accounts.pinPlayer(legacyAccountIds.failed, 601)
        await runtime.accounts.pinPlayer(legacyAccountIds.failed, 602)
        await runtime.accounts.pinPlayer(legacyAccountIds.failed, 601)
        await runtime.accounts.pinPlayer(legacyAccountIds.conflict, 701)
        await runtime.accounts.pinPlayer(legacyAccountIds.conflict, 702)
        await runtime.accounts.pinPlayer(legacyAccountIds.conflict, 701)
        await runtime.accounts.pinPlayer(legacyAccountIds.conflict, 702)
        await runtime.accounts.pinPlayer(legacyAccountIds.duplicateA, 801)

        await fence.unsafe("SELECT pg_advisory_lock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        fenceHeld = true
        writers = [
          runtime.accounts.signOut(signIn.sessionToken),
          runtime.accounts.resolvePrimaryPlayerVerification(attempt.id, { resolve: async () => null }),
          runtime.accounts.unpinPlayer(legacyAccountIds.pending, 501),
          runtime.accounts.pinPlayer(legacyAccountIds.duplicateA, 801),
          runtime.accounts.unpinPlayer(legacyAccountIds.failed, 601),
          runtime.accounts.reorderPinnedPlayers(legacyAccountIds.conflict, [702, 701]),
        ]
        await waitForAdvisoryWaiters(inspect, 'ShareLock', writers.length)

        await fence.unsafe("SELECT pg_advisory_unlock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        fenceHeld = false
        await Promise.all(writers)
        expect(await runtime.accounts.authenticate(signIn.sessionToken)).toEqual({ status: 'anonymous' })
        expect(await runtime.accounts.getPinnedPlayers(legacyAccountIds.pending)).toEqual([])
        expect(await runtime.accounts.getPlayerShortcuts(legacyAccountIds.failed)).toMatchObject({
          pinnedPlayers: [{ brawlhallaId: 602 }],
        })
        expect(await runtime.accounts.getPlayerShortcuts(legacyAccountIds.conflict)).toMatchObject({
          pinnedPlayers: [{ brawlhallaId: 702 }, { brawlhallaId: 701 }],
        })
      } finally {
        if (fenceHeld) {
          await fence.unsafe("SELECT pg_advisory_unlock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        }
        await Promise.allSettled(writers)
        await runtime.close()
        await inspect.end()
        await fence.end()
      }
    })
  }, 30_000)

  test('fails runtime writers with a bounded retryable maintenance signal', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const fence = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let fenceHeld = false
      try {
        await fence.unsafe("SELECT pg_advisory_lock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        fenceHeld = true
        const startedAt = Date.now()
        const write = runtime.accounts.updatePreferences(legacyAccountIds.linked, {
          version: 1,
          leaderboardBracket: '2v2',
          leaderboardRegion: 'EU',
        })
        await expect(write).rejects.toMatchObject({
          name: AccountsMaintenanceError.name,
          retryAfterSeconds: 5,
        })
        expect(Date.now() - startedAt).toBeLessThan(5_000)
      } finally {
        if (fenceHeld) {
          await fence.unsafe("SELECT pg_advisory_unlock(hashtextextended('accounts:writer-maintenance-fence', 0))")
        }
        await runtime.close()
        await fence.end()
      }
    })
  }, 15_000)

  test('does not classify ordinary Accounts lock contention as maintenance', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const blocker = postgres(databaseUrl, { max: 1 })
      const probe = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let blockerHeld = false
      let signIn: Promise<unknown> | null = null
      try {
        await blocker.unsafe("SELECT pg_advisory_lock(hashtextextended('discord:ordinary-contention', 0))")
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

        await blocker.unsafe("SELECT pg_advisory_unlock(hashtextextended('discord:ordinary-contention', 0))")
        blockerHeld = false
        await expect(signIn).resolves.toMatchObject({ account: { displayName: 'Ordinary contention' } })
      } finally {
        if (blockerHeld) {
          await blocker.unsafe("SELECT pg_advisory_unlock(hashtextextended('discord:ordinary-contention', 0))")
        }
        if (signIn) await Promise.allSettled([signIn])
        await runtime.close()
        await probe.end()
        await blocker.end()
      }
    })
  }, 15_000)

  test('prevents a destination write from overlapping the live import transaction', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const sourceBlocker = postgres(databaseUrl, { max: 1 })
      const probe = postgres(databaseUrl, { max: 1 })
      const inspect = postgres(databaseUrl, { max: 1 })
      const runtime = createPostgresAccounts(databaseUrl)
      let releaseSource!: () => void
      let sourceLocked!: () => void
      const sourceRelease = new Promise<void>((resolve) => {
        releaseSource = resolve
      })
      const sourceReady = new Promise<void>((resolve) => {
        sourceLocked = resolve
      })
      const heldSource = sourceBlocker.begin(async (transaction) => {
        await transaction.unsafe('LOCK TABLE public."user" IN ACCESS EXCLUSIVE MODE')
        sourceLocked()
        await sourceRelease
      })
      let importing: Promise<Awaited<ReturnType<typeof importLegacyAccounts>>> | null = null
      let writing: Promise<unknown> | null = null
      try {
        await sourceReady
        importing = importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        await waitForImportWriterFence(probe)

        let writerSettled = false
        writing = runtime.accounts
          .updatePreferences(legacyAccountIds.linked, {
            version: 1,
            leaderboardBracket: '2v2',
            leaderboardRegion: 'EU',
          })
          .finally(() => {
            writerSettled = true
          })
        await waitForAdvisoryWaiters(inspect, 'ShareLock', 1)
        expect(writerSettled).toBe(false)
        await expect(writing).rejects.toMatchObject({
          name: AccountsMaintenanceError.name,
          retryAfterSeconds: 5,
        })
        const [duringImport] = await inspect<Array<{ preferences: number }>>`
          SELECT count(*)::integer AS preferences FROM accounts.preferences
        `
        expect(duringImport.preferences).toBe(0)

        releaseSource()
        await heldSource
        expect(await importing).toMatchObject({ status: 'complete', reconciliation: { exact: true } })
        await runtime.accounts.updatePreferences(legacyAccountIds.linked, {
          version: 1,
          leaderboardBracket: '2v2',
          leaderboardRegion: 'EU',
        })
        const [afterImport] = await inspect<Array<{ preferences: number }>>`
          SELECT count(*)::integer AS preferences FROM accounts.preferences
        `
        expect(afterImport.preferences).toBe(1)
      } finally {
        releaseSource()
        await Promise.resolve(heldSource).catch(() => undefined)
        await Promise.allSettled([...(importing ? [importing] : []), ...(writing ? [writing] : [])])
        await runtime.close()
        await inspect.end()
        await probe.end()
        await sourceBlocker.end()
      }
    })
  }, 30_000)

  test('waits for in-flight Accounts writers before manifest capture', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const writer = postgres(databaseUrl, { max: 1 })
      const inspect = postgres(databaseUrl, { max: 1 })
      let writerHeld = false
      let importing: Promise<Awaited<ReturnType<typeof importLegacyAccounts>>> | null = null
      try {
        await writer.unsafe("SELECT pg_advisory_lock_shared(hashtextextended('accounts:writer-maintenance-fence', 0))")
        writerHeld = true
        importing = importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        await waitForAdvisoryWaiters(inspect, 'ExclusiveLock', 1)
        const [duringWriter] = await inspect<Array<{ events: number; progress: number }>>`
          SELECT
            (SELECT count(*)::integer FROM accounts.legacy_import_audit_events) AS events,
            (SELECT count(*)::integer FROM accounts.legacy_import_progress) AS progress
        `
        expect(duringWriter).toEqual({ events: 0, progress: 0 })

        await writer.unsafe(
          "SELECT pg_advisory_unlock_shared(hashtextextended('accounts:writer-maintenance-fence', 0))",
        )
        writerHeld = false
        expect(await importing).toMatchObject({ status: 'complete', reconciliation: { exact: true } })
      } finally {
        if (writerHeld) {
          await writer.unsafe(
            "SELECT pg_advisory_unlock_shared(hashtextextended('accounts:writer-maintenance-fence', 0))",
          )
        }
        if (importing) await Promise.allSettled([importing])
        await inspect.end()
        await writer.end()
      }
    })
  }, 30_000)

  test('rolls back a failed batch and resumes without duplicate evidence', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      const orderedIds = Object.values(legacyAccountIds).sort()
      const blockedSourceKey = orderedIds[1]
      try {
        await inspect.unsafe(`
          CREATE FUNCTION accounts.fail_import_batch_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.source_table = 'user' AND NEW.source_key = '${blockedSourceKey}' THEN
              RAISE EXCEPTION 'injected import failure';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_import_batch_for_test
          BEFORE INSERT ON accounts.legacy_import_ledger
          FOR EACH ROW EXECUTE FUNCTION accounts.fail_import_batch_for_test();
        `)
        const first = await importLegacyAccounts(databaseUrl, {
          legacyWritersQuiesced: true,
          batchSize: 1,
          maxBatches: 1,
        })
        expect(first.status).toBe('in-progress')
        await expect(
          importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true, batchSize: 1, maxBatches: 1 }),
        ).rejects.toThrow('injected import failure')

        const [duringFailure] = await inspect<Array<{ rows: number; ledger: number }>>`
          SELECT
            (SELECT count(*)::integer FROM accounts.legacy_archive WHERE source_table = 'user') AS rows,
            (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE source_table = 'user') AS ledger
        `
        expect(duringFailure).toEqual({ rows: 1, ledger: 1 })

        await inspect.unsafe(`
          DROP TRIGGER fail_import_batch_for_test ON accounts.legacy_import_ledger;
          DROP FUNCTION accounts.fail_import_batch_for_test();
        `)
        const resumed = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true, batchSize: 1 })
        expect(resumed).toMatchObject({ status: 'complete', reconciliation: { exact: true } })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('atomically rolls back a blocked checkpoint when blocked-audit persistence fails', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE accounts.oauth_identities
          SET account_id = ${legacyAccountIds.pending}
          WHERE provider = 'future-provider' AND provider_account_id = 'future-linked'
        `
        await inspect.unsafe(`
          CREATE FUNCTION accounts.fail_blocked_audit_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.event = 'blocked' THEN RAISE EXCEPTION 'injected blocked audit failure'; END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_blocked_audit_for_test
          BEFORE INSERT ON accounts.legacy_import_audit_events
          FOR EACH ROW EXECUTE FUNCTION accounts.fail_blocked_audit_for_test();
        `)
        await expect(importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).rejects.toThrow(
          'injected blocked audit failure',
        )
        const [rolledBack] = await inspect<
          Array<{
            status: string
            stage: string
            source_key: string | null
            oauth_archive: number
            oauth_ledger: number
          }>
        >`
          SELECT
            status,
            stage,
            last_source_key AS source_key,
            (SELECT count(*)::integer FROM accounts.legacy_archive WHERE source_table = 'oauth_account') AS oauth_archive,
            (SELECT count(*)::integer FROM accounts.legacy_import_ledger WHERE source_table = 'oauth_account') AS oauth_ledger
          FROM accounts.legacy_import_progress
        `
        expect(rolledBack).toEqual({
          status: 'in-progress',
          stage: 'oauth-identities',
          source_key: null,
          oauth_archive: 0,
          oauth_ledger: 0,
        })

        await inspect.unsafe(`
          DROP TRIGGER fail_blocked_audit_for_test ON accounts.legacy_import_audit_events;
          DROP FUNCTION accounts.fail_blocked_audit_for_test();
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
        const [durable] = await inspect<Array<{ blocked_events: number; rejection_rows: number }>>`
          SELECT
            (SELECT count(*)::integer FROM accounts.legacy_import_audit_events WHERE event = 'blocked') AS blocked_events,
            (SELECT count(*)::integer FROM accounts.legacy_import_rejections
             WHERE code = 'identity-ownership-conflict') AS rejection_rows
        `
        expect(durable).toEqual({ blocked_events: 1, rejection_rows: 1 })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('durably blocks source drift and identity ownership collisions', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        expect(
          (
            await importLegacyAccounts(databaseUrl, {
              legacyWritersQuiesced: true,
              batchSize: 1,
              maxBatches: 1,
            })
          ).status,
        ).toBe('in-progress')
        await inspect`UPDATE public.oauth_account SET username = 'Changed after freeze' WHERE provider = 'discord'`
        const blocked = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(blocked).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toEqual(blocked)
      } finally {
        await inspect.end()
      }
    })

    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE accounts.oauth_identities
          SET account_id = ${legacyAccountIds.pending}
          WHERE provider = 'future-provider' AND provider_account_id = 'future-linked'
        `
        const blocked = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(blocked).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
        const [rejection] = await inspect<Array<{ code: string }>>`
          SELECT code FROM accounts.legacy_import_rejections
          WHERE source_table = 'oauth_account' AND code = 'identity-ownership-conflict'
        `
        expect(rejection.code).toBe('identity-ownership-conflict')
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('preserves naive V2 UTC timestamps when the importer host is not UTC', async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      await withFixtureDatabase(async (databaseUrl) => {
        const result = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(result).toMatchObject({ status: 'complete', reconciliation: { exact: true } })
        const inspect = postgres(databaseUrl, { max: 1 })
        try {
          const [user] = await inspect<Array<{ created_at: Date }>>`
            SELECT created_at FROM accounts.users WHERE id = ${legacyAccountIds.linked}
          `
          expect(user.created_at.toISOString()).toBe('2026-08-01T01:02:03.123Z')
        } finally {
          await inspect.end()
        }
      })
    } finally {
      if (originalTimeZone === undefined) process.env.TZ = undefined
      else process.env.TZ = originalTimeZone
    }
  }, 30_000)

  test('rolls back auth cutover before durably blocking failed final reconciliation', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          CREATE FUNCTION accounts.corrupt_final_reconciliation_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            UPDATE accounts.oauth_identities
            SET display_name = 'Injected final mismatch'
            WHERE provider = 'future-provider' AND provider_account_id = 'future-linked';
            RETURN NEW;
          END $$;
          CREATE TRIGGER corrupt_final_reconciliation_for_test
          AFTER INSERT ON accounts.v2_auth_cutover
          FOR EACH ROW EXECUTE FUNCTION accounts.corrupt_final_reconciliation_for_test();
        `)
        const result = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(result).toMatchObject({ status: 'blocked', reconciliation: { exact: false } })
        const [state] = await inspect<
          Array<{
            cutover: boolean
            imported: boolean
            display_name: string
            import_status: string
            block_code: string
            blocked_events: number
          }>
        >`
          SELECT
            EXISTS (SELECT 1 FROM accounts.v2_auth_cutover) AS cutover,
            (SELECT imported_from_v2 FROM accounts.sessions
             WHERE account_id = ${legacyAccountIds.linked} AND expires_at > CURRENT_TIMESTAMP LIMIT 1) AS imported,
            (SELECT display_name FROM accounts.oauth_identities
             WHERE provider = 'future-provider' AND provider_account_id = 'future-linked') AS display_name,
            (SELECT status FROM accounts.legacy_import_progress WHERE singleton) AS import_status,
            (SELECT block_reason->>'code' FROM accounts.legacy_import_progress WHERE singleton) AS block_code,
            (SELECT count(*)::integer FROM accounts.legacy_import_audit_events WHERE event = 'blocked') AS blocked_events
        `
        expect(state).toEqual({
          cutover: false,
          imported: true,
          display_name: 'Linked elsewhere',
          import_status: 'blocked',
          block_code: 'reconciliation-failed',
          blocked_events: 1,
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('allows natural session expiry between a committed checkpoint and finalization', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE public.session
          SET expires_at = (clock_timestamp() + interval '1.5 seconds') AT TIME ZONE 'UTC'
          WHERE user_id = ${legacyAccountIds.linked} AND expires_at > CURRENT_TIMESTAMP
        `
        const partial = await importLegacyAccounts(databaseUrl, {
          legacyWritersQuiesced: true,
          batchSize: 500,
          maxBatches: 3,
        })
        expect(partial).toMatchObject({ status: 'in-progress', reconciliation: { preservedValidSessions: 1 } })
        await Bun.sleep(1_600)
        const completed = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(completed).toMatchObject({
          status: 'complete',
          reconciliation: { exact: true, preservedValidSessions: 0 },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay if retained V2 sources drift', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`UPDATE public.oauth_account SET username = 'Post-completion drift' WHERE provider = 'discord'`
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when destination identity semantics drift', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE accounts.oauth_identities SET display_name = 'Destination drift'
          WHERE provider = 'future-provider' AND provider_account_id = 'future-linked'
        `
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when auth cutover state is missing', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`DELETE FROM accounts.v2_auth_cutover`
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when a session returns to compatibility ownership', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE accounts.sessions SET imported_from_v2 = true
          WHERE account_id = ${legacyAccountIds.linked}
        `
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when stored reconciliation evidence drifts', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE accounts.legacy_import_progress
          SET reconciliation = jsonb_set(reconciliation, '{preservedUsers}', '0'::jsonb)
        `
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when immutable completion audit evidence is partially deleted', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_import_audit_events
            DISABLE TRIGGER accounts_legacy_import_audit_immutable;
          DELETE FROM accounts.legacy_import_audit_events
          WHERE id = (SELECT max(id) FROM accounts.legacy_import_audit_events WHERE event = 'completed');
          ALTER TABLE accounts.legacy_import_audit_events
            ENABLE TRIGGER accounts_legacy_import_audit_immutable;
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks audit snapshot downgrade after partial terminal evidence deletion', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_import_audit_events
            DISABLE TRIGGER accounts_legacy_import_audit_immutable;
          DELETE FROM accounts.legacy_import_audit_events
          WHERE id = (SELECT max(id) FROM accounts.legacy_import_audit_events WHERE event = 'completed');
          ALTER TABLE accounts.legacy_import_audit_events
            ENABLE TRIGGER accounts_legacy_import_audit_immutable;
        `)
        await inspect`
          UPDATE accounts.legacy_import_progress
          SET reconciliation = reconciliation - 'auditEventCount' - 'auditChecksum'
        `
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('accepts replay after a rolled-back audit identity allocation', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await expect(
          inspect.begin(async (transaction) => {
            await transaction.unsafe(
              `INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
               VALUES ($1, 'started', '{"manifestVersion":1}'::jsonb)`,
              [crypto.randomUUID()],
            )
            throw new Error('injected audit transaction rollback')
          }),
        ).rejects.toThrow('injected audit transaction rollback')
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'complete',
          reconciliation: { exact: true },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('accepts immutable replay audit evidence emitted by the prior importer', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_import_audit_events
            DISABLE TRIGGER accounts_legacy_import_audit_immutable;
          UPDATE accounts.legacy_import_audit_events
          SET evidence = evidence - 'attestationVersion'
          WHERE event = 'completed';
          ALTER TABLE accounts.legacy_import_audit_events
            ENABLE TRIGGER accounts_legacy_import_audit_immutable;
        `)
        await inspect`
          UPDATE accounts.legacy_import_progress
          SET reconciliation = reconciliation - 'auditEventCount' - 'auditChecksum'
        `
        const legacyReplayRunId = crypto.randomUUID()
        await inspect`
          INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
          VALUES (${legacyReplayRunId}, 'started', '{"manifestVersion":1}'::jsonb)
        `
        await inspect`
          INSERT INTO accounts.legacy_import_audit_events (run_id, event, evidence)
          VALUES (${legacyReplayRunId}, 'completed', '{"exact":true,"replayed":true}'::jsonb)
        `
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'complete',
          reconciliation: { exact: true },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks a completed replay when rejection evidence is missing', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_import_rejections
            DISABLE TRIGGER accounts_legacy_import_rejections_immutable;
          DELETE FROM accounts.legacy_import_rejections;
          ALTER TABLE accounts.legacy_import_rejections
            ENABLE TRIGGER accounts_legacy_import_rejections_immutable;
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks completed replay when rejection code or evidence is mutated', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_import_rejections
            DISABLE TRIGGER accounts_legacy_import_rejections_immutable;
          UPDATE accounts.legacy_import_rejections
          SET code = 'forged-rejection', evidence = '{"reason":"forged"}'::jsonb;
          ALTER TABLE accounts.legacy_import_rejections
            ENABLE TRIGGER accounts_legacy_import_rejections_immutable;
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('blocks completed replay when immutable trigger functions become no-ops', async () => {
    for (const [functionName, expectedErrorText] of [
      ['accounts.reject_legacy_import_evidence_change', 'Accounts legacy migration evidence is immutable'],
      ['accounts.reject_primary_player_history_mutation', 'Primary Player verification history is immutable'],
    ]) {
      await withFixtureDatabase(async (databaseUrl) => {
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'complete',
        })
        const inspect = postgres(databaseUrl, { max: 1 })
        try {
          await inspect.unsafe(`
            CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN /* ${expectedErrorText} */ RETURN NULL; END $$;
          `)
          expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
            status: 'blocked',
            reconciliation: { exact: false },
          })
        } finally {
          await inspect.end()
        }
      })
    }
  }, 30_000)

  test('blocks completed replay when any required evidence trigger is disabled', async () => {
    for (const [table, trigger] of requiredEvidenceTriggers) {
      await withFixtureDatabase(async (databaseUrl) => {
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'complete',
        })
        const inspect = postgres(databaseUrl, { max: 1 })
        try {
          await inspect.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`)
          expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
            status: 'blocked',
            reconciliation: { exact: false },
          })
        } finally {
          await inspect.end()
        }
      })
    }
  }, 90_000)

  test('blocks forged archive checksum evidence without crossing auth cutover', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(
        (
          await importLegacyAccounts(databaseUrl, {
            legacyWritersQuiesced: true,
            batchSize: 1,
            maxBatches: 1,
          })
        ).status,
      ).toBe('in-progress')
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_archive DISABLE TRIGGER accounts_legacy_archive_immutable;
          UPDATE accounts.legacy_archive SET content_checksum = repeat('0', 64) WHERE source_table = 'user';
          ALTER TABLE accounts.legacy_archive ENABLE TRIGGER accounts_legacy_archive_immutable;
        `)
        const result = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(result).toMatchObject({ status: 'blocked', reconciliation: { exact: false } })
        const [state] = await inspect<Array<{ cutover: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM accounts.v2_auth_cutover) AS cutover
        `
        expect(state.cutover).toBe(false)
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('revalidates completed archive and attempt evidence on replay', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.legacy_archive DISABLE TRIGGER accounts_legacy_archive_immutable;
          UPDATE accounts.legacy_archive
          SET raw_row = jsonb_set(raw_row, '{updated_at}', '"2099-01-01 00:00:00"'::jsonb)
          WHERE source_table = 'user';
          ALTER TABLE accounts.legacy_archive ENABLE TRIGGER accounts_legacy_archive_immutable;
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })

    await withFixtureDatabase(async (databaseUrl) => {
      expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
        status: 'complete',
      })
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect.unsafe(`
          ALTER TABLE accounts.primary_player_verification_outcomes
            DISABLE TRIGGER primary_player_outcomes_immutable;
          UPDATE accounts.primary_player_verification_outcomes
          SET completed_at = completed_at + interval '1 minute';
          ALTER TABLE accounts.primary_player_verification_outcomes
            ENABLE TRIGGER primary_player_outcomes_immutable;
        `)
        expect(await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 60_000)

  test('blocks rejected legacy rows that left opportunistic attempt history', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const inspect = postgres(databaseUrl, { max: 1 })
      try {
        await inspect`
          UPDATE public.player_link SET status = 'unsupported'
          WHERE user_id = ${legacyAccountIds.failed}
        `
        const result = await importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: true })
        expect(result).toMatchObject({
          status: 'blocked',
          reconciliation: { exact: false, preservedAttempts: 9 },
        })
      } finally {
        await inspect.end()
      }
    })
  }, 30_000)

  test('requires explicit quiescence', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      await expect(importLegacyAccounts(databaseUrl, { legacyWritersQuiesced: false } as never)).rejects.toThrow(
        'Legacy Accounts writers must be quiescent',
      )
    })
  }, 15_000)
})
