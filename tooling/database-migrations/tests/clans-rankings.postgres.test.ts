import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { clanMigrationInventory, createPostgresClans, importLegacyClans } from '@brawltome/clan/composition'
import { createPostgresRanking, importLegacyRankings, rankingMigrationInventory } from '@brawltome/ranking/composition'
import postgres from 'postgres'
import { globalMigrationInventory } from '../src/inventories'
import { migratePostgres } from '../src/postgres'
import { legacyClanRankingRowsSql, legacyClanRankingSchemaSql } from './fixtures/legacy-clans-rankings'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_clan_ranking_import_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

async function initializeDatabase(databaseUrl: string): Promise<void> {
  const setup = postgres(databaseUrl, { max: 1 })
  try {
    await setup.unsafe(legacyClanRankingSchemaSql)
    for (const migration of clanMigrationInventory) await setup.unsafe(migration.sql)
    for (const migration of rankingMigrationInventory) await setup.unsafe(migration.sql)
    await setup.unsafe(legacyClanRankingRowsSql)
  } finally {
    await setup.end()
  }
}

beforeAll(async () => {
  const configured = new URL(configuredServer ?? '')
  const dedicated = new URL(dedicatedServer)
  if (
    configured.protocol !== dedicated.protocol ||
    configured.hostname !== dedicated.hostname ||
    configured.port !== dedicated.port ||
    configured.username !== dedicated.username ||
    configured.password !== dedicated.password
  ) {
    throw new Error(`Clan and Ranking migration tests require the dedicated server ${dedicatedServer}`)
  }

  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  await initializeDatabase(connectionString)
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function withFixtureDatabase(run: (databaseUrl: string) => Promise<void>): Promise<void> {
  const isolatedName = `bt_clan_rank_case_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${isolatedName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${isolatedName}`
  try {
    await initializeDatabase(databaseUrl.toString())
    await run(databaseUrl.toString())
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`)
  }
}

async function runFullRehearsal() {
  const isolatedName = `bt_223_rehearsal_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${isolatedName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${isolatedName}`
  const connection = databaseUrl.toString()
  const setup = postgres(connection, { max: 1 })
  try {
    await setup.unsafe(legacyClanRankingSchemaSql)
    await setup.unsafe(legacyClanRankingRowsSql)
    await migratePostgres(connection, globalMigrationInventory)
    const clans = await importLegacyClans(connection)
    const rankings = await importLegacyRankings(connection)
    const history = await setup<{ identity: string }[]>`
      SELECT identity FROM brawltome_migrations.history ORDER BY ordinal
    `
    return {
      clans,
      rankings,
      history: history.map(({ identity }) => identity),
    }
  } finally {
    await setup.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`)
  }
}

describe('Clans and Rankings V2 import', () => {
  test('produces identical evidence in two consecutive full-plan local rehearsals', async () => {
    const first = await runFullRehearsal()
    const second = await runFullRehearsal()
    expect(first).toEqual(second)
    expect(first.clans.status).toBe('complete')
    expect(first.rankings.status).toBe('complete')
    expect(first.history).toEqual(globalMigrationInventory.map(({ identity }) => identity))
  }, 60_000)

  test('archives every source row and reconciles Clan ownership without claiming roster freshness', async () => {
    const first = await importLegacyClans(connectionString, {
      batchSize: 1,
      maxBatches: 1,
    })
    expect(first.status).toBe('in-progress')
    expect(first.checkpoint).toEqual({ stage: 'clans', sourceKey: '1' })

    const [completed, concurrent] = await Promise.all([
      importLegacyClans(connectionString, { batchSize: 1 }),
      importLegacyClans(connectionString, { batchSize: 1 }),
    ])
    expect(completed.status).toBe('complete')
    expect(concurrent).toEqual(completed)
    expect(completed.reconciliation).toMatchObject({
      sourceRows: 9,
      archivedRows: 9,
      sourceChecksum: completed.reconciliation.archiveChecksum,
      semanticExact: true,
      exact: true,
    })
    expect(await importLegacyClans(connectionString)).toEqual(completed)

    const clans = createPostgresClans(connectionString)
    const inspect = postgres(connectionString)
    try {
      const clan = await clans.getById(1)
      expect(clan).toMatchObject({
        clanId: 1,
        clanName: 'Archive Keepers',
        profile: {
          checkedAt: new Date('2026-08-01T10:00:00Z'),
          checkProvenance: {
            source: 'legacy-import',
            outcome: 'legacy-unknown',
            sourceTable: 'clan',
            sourceKey: '1',
            archiveChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          lastSuccessAt: null,
        },
        roster: {
          checkedAt: null,
          checkProvenance: {
            source: 'legacy-import',
            outcome: 'legacy-unknown',
            sourceTables: ['clan_member', 'player_clan'],
          },
          lastSuccessAt: null,
        },
        members: [
          expect.objectContaining({
            brawlhallaId: 10,
            name: 'Alpha',
            xp: '500',
          }),
        ],
      })

      expect(await clans.getPlayerMembership(10)).toMatchObject({
        clanId: 1,
        clanName: 'Archive Keepers',
      })
      expect(await clans.getPlayerMembership(20)).toBeNull()
      expect(await clans.getById(-3)).toBeNull()

      const rejections = await inspect<Array<{ source_table: string; source_key: string; code: string }>>`
        SELECT source_table, source_key, code
        FROM clans.legacy_import_rejections
        ORDER BY source_table, source_key, code
      `
      expect(rejections).toEqual(
        expect.arrayContaining([
          {
            source_table: 'clan',
            source_key: '-3',
            code: 'clan-identity-invalid',
          },
          {
            source_table: 'clan_member',
            source_key: '2:20',
            code: 'legacy-membership-disagreement',
          },
          {
            source_table: 'player_clan',
            source_key: '30',
            code: 'legacy-membership-missing-roster',
          },
        ]),
      )

      const [archive] = await inspect<
        Array<{
          rows: number
          valid_rows: number
          source_checksum: string
          archive_checksum: string
        }>
      >`
        SELECT count(*)::integer AS rows,
               count(*) FILTER (
                 WHERE row_checksum ~ '^[a-f0-9]{64}$'
                   AND content_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex')
               )::integer AS valid_rows,
               ${completed.reconciliation.sourceChecksum}::text AS source_checksum,
               ${completed.reconciliation.archiveChecksum}::text AS archive_checksum
        FROM clans.legacy_archive
      `
      expect(archive).toEqual({
        rows: 9,
        valid_rows: 9,
        source_checksum: archive.archive_checksum,
        archive_checksum: archive.source_checksum,
      })

      await expect(
        Promise.resolve(
          inspect`UPDATE clans.legacy_archive SET raw_row = '{}'::jsonb WHERE source_table = 'clan' AND source_key = '1'`,
        ),
      ).rejects.toThrow('Clans legacy migration evidence is immutable')
      await expect(Promise.resolve(inspect`TRUNCATE clans.legacy_archive CASCADE`)).rejects.toThrow(
        'Clans legacy migration evidence is immutable',
      )

      await clans.publishProfile(
        {
          clanId: 1,
          clanName: 'Fresh Owner Profile',
          clanCreateDate: new Date('2020-01-01T00:00:00Z'),
          clanXp: '1100',
          clanLifetimeXp: '5100',
          notice: 'fresh',
          tags: [],
          discordInviteCode: '',
          guildPoints: '10',
          isRecruiting: false,
        },
        new Date('2026-08-03T00:00:00Z'),
        { source: 'v1-guild-stats', outcome: 'success' },
      )
      expect(await importLegacyClans(connectionString)).toEqual(completed)
      expect((await clans.getById(1))?.clanName).toBe('Fresh Owner Profile')
    } finally {
      await inspect.end()
      await clans.close()
    }
  }, 30_000)

  test('preserves bigint Clan facts exactly without JSON number rounding', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        const largeXp = '9007199254740993'
        await control`UPDATE public.clan SET clan_xp = ${largeXp} WHERE clan_id = 1`
        await control`UPDATE public.player_clan SET clan_xp = ${largeXp} WHERE clan_id = 1`
        const completed = await importLegacyClans(databaseUrl)
        expect(completed.status).toBe('complete')
        const [stored] = await control<{ profile_xp: string; archive_xp: string; member_key: boolean }[]>`
          SELECT profile.clan_xp::text AS profile_xp,
                 archive.raw_row->>'clan_xp' AS archive_xp,
                 EXISTS (
                   SELECT 1 FROM clans.legacy_archive
                   WHERE source_table = 'clan_member' AND source_key = '1:10'
                 ) AS member_key
          FROM clans.profiles profile
          JOIN clans.legacy_archive archive
            ON archive.source_table = 'clan' AND archive.source_key = profile.clan_id::text
          WHERE profile.clan_id = 1
        `
        expect(stored).toEqual({ profile_xp: largeXp, archive_xp: largeXp, member_key: true })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('preserves proven owner-success Clan facts and records why legacy rows were not applied', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const clans = createPostgresClans(databaseUrl)
      const inspect = postgres(databaseUrl, { max: 1 })
      const checkedAt = new Date('2026-08-03T00:00:00Z')
      try {
        await clans.publishProfile(
          {
            clanId: 1,
            clanName: 'Owner Fresh Profile',
            clanCreateDate: new Date('2020-01-01T00:00:00Z'),
            clanXp: '1200',
            clanLifetimeXp: '5200',
            notice: 'fresh',
            tags: [],
            discordInviteCode: '',
            guildPoints: '1',
            isRecruiting: false,
          },
          checkedAt,
          { source: 'v1-guild-stats', outcome: 'success' },
        )
        await clans.publishRoster(
          1,
          [
            {
              brawlhallaId: 10,
              name: 'Owner Fresh Alpha',
              rank: 'Leader',
              joinDate: new Date('2020-01-02T00:00:00Z'),
              xp: '600',
              guildPoints: '1',
            },
          ],
          checkedAt,
          { source: 'v1-guild-members', outcome: 'success' },
        )

        const completed = await importLegacyClans(databaseUrl)
        expect(completed.status).toBe('complete')
        expect(completed.reconciliation.exact).toBe(true)
        expect(await clans.getById(1)).toMatchObject({
          clanName: 'Owner Fresh Profile',
          members: [expect.objectContaining({ name: 'Owner Fresh Alpha', xp: '600' })],
        })
        const reasons = await inspect<{ source_table: string; code: string }[]>`
          SELECT source_table, code FROM clans.legacy_import_rejections
          WHERE source_key IN ('1', '1:10', '10')
          ORDER BY source_table
        `
        expect([...reasons]).toEqual([
          { source_table: 'clan', code: 'destination-owner-profile-preserved' },
          {
            source_table: 'clan_member',
            code: 'destination-owner-roster-preserved',
          },
          {
            source_table: 'player_clan',
            code: 'destination-owner-roster-preserved',
          },
        ])
      } finally {
        await inspect.end()
        await clans.close()
      }
    })
  }, 30_000)

  test('publishes only sets passing every gate and keeps rejected raw sets with reasons', async () => {
    const first = await importLegacyRankings(connectionString, {
      batchSize: 1,
      maxBatches: 1,
    })
    expect(first.status).toBe('in-progress')

    const [completed, concurrent] = await Promise.all([
      importLegacyRankings(connectionString, { batchSize: 2 }),
      importLegacyRankings(connectionString, { batchSize: 2 }),
    ])
    expect(completed.status).toBe('complete')
    expect(concurrent).toEqual(completed)
    expect(completed.reconciliation).toMatchObject({
      sourceRows: 19,
      archivedRows: 19,
      acceptedSets: 4,
      rejectedSets: 32,
      publishedModes: 4,
      publishedSnapshots: 4,
      sourceChecksum: completed.reconciliation.archiveChecksum,
      semanticExact: true,
      exact: true,
    })
    expect(await importLegacyRankings(connectionString)).toEqual(completed)

    const ranking = createPostgresRanking(connectionString)
    const inspect = postgres(connectionString)
    try {
      const expectedModes = ['1v1', '2v2', 'solo2v2', '3v3'] as const
      for (const mode of expectedModes) {
        const leaderboard = await ranking.queries.getLeaderboard({
          mode,
          region: 'EU',
          page: 1,
        })
        expect(leaderboard).toMatchObject({
          status: 'stale',
          mode,
          region: 'EU',
          provenance: {
            source: 'v2-legacy',
            contractVersion: 1,
            sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        })
        if (leaderboard.status !== 'stale') throw new Error(`${mode}/EU legacy snapshot was not published`)
        expect(leaderboard.totalRows).toBe(mode === '1v1' || mode === '3v3' ? 2 : 1)
      }

      const rejected = await inspect<
        Array<{
          mode: string
          scope: string
          reasons: string[]
          gates: Record<string, boolean>
        }>
      >`
        SELECT mode, scope, reasons, gates
        FROM rankings.legacy_import_sets
        WHERE status = 'rejected' AND scope IN ('US-E', 'US-W', 'AUS', 'JPN', 'SEA')
        ORDER BY mode, scope
      `
      expect(rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mode: '1v1',
            scope: 'US-E',
            reasons: ['peak-rating-below-rating'],
          }),
          expect.objectContaining({
            mode: '1v1',
            scope: 'AUS',
            reasons: ['ordering-ambiguous-tie'],
          }),
          expect.objectContaining({
            mode: '1v1',
            scope: 'JPN',
            reasons: ['set-observation-span-exceeded'],
          }),
          expect.objectContaining({
            mode: '2v2',
            scope: 'US-E',
            reasons: ['fixed-team-owner-cardinality'],
          }),
          expect.objectContaining({
            mode: 'solo2v2',
            scope: 'SEA',
            reasons: ['contestant-identity-unresolved'],
          }),
          expect.objectContaining({
            mode: '3v3',
            scope: 'US-W',
            reasons: ['set-empty'],
          }),
        ]),
      )
      expect(
        rejected.every(
          ({ gates }) =>
            Object.keys(gates).sort().join(',') === 'cardinality,completeness,contestantIdentity,immutability,ordering',
        ),
      ).toBe(true)
      expect(rejected.find(({ mode, scope }) => mode === '1v1' && scope === 'AUS')?.gates.ordering).toBe(false)
      expect(rejected.find(({ mode, scope }) => mode === '1v1' && scope === 'JPN')?.gates.completeness).toBe(false)
      expect(rejected.find(({ mode, scope }) => mode === 'solo2v2' && scope === 'SEA')?.gates.contestantIdentity).toBe(
        false,
      )

      const accepted = await inspect<Array<{ mode: string; scope: string; gates: Record<string, boolean> }>>`
        SELECT mode, scope, gates FROM rankings.legacy_import_sets WHERE status = 'accepted' ORDER BY mode
      `
      expect(accepted).toHaveLength(4)
      expect(accepted.every(({ scope, gates }) => scope === 'EU' && Object.values(gates).every(Boolean))).toBe(true)

      const [archive] = await inspect<Array<{ rows: number; valid_rows: number }>>`
        SELECT count(*)::integer AS rows,
               count(*) FILTER (
                 WHERE row_checksum ~ '^[a-f0-9]{64}$'
                   AND content_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex')
               )::integer AS valid_rows
        FROM rankings.legacy_archive
      `
      expect(archive).toEqual({ rows: 19, valid_rows: 19 })

      await expect(Promise.resolve(inspect`DELETE FROM rankings.snapshot_rows WHERE mode = '1v1'`)).rejects.toThrow(
        'published ranking snapshots are immutable',
      )
      await expect(Promise.resolve(inspect`TRUNCATE rankings.snapshot_rows CASCADE`)).rejects.toThrow(
        'published ranking snapshots are immutable',
      )
      await expect(Promise.resolve(inspect`TRUNCATE rankings.legacy_archive CASCADE`)).rejects.toThrow(
        'Ranking legacy migration evidence is immutable',
      )
    } finally {
      await inspect.end()
      await ranking.close()
    }
  }, 30_000)

  test('blocks resume durably when a frozen V2 source changes', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyClans(databaseUrl, { batchSize: 1, maxBatches: 1 })).status).toBe('in-progress')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.clan SET clan_name = 'Changed During Import' WHERE clan_id = 2`
        const blocked = await importLegacyClans(databaseUrl)
        expect(blocked.status).toBe('blocked')
        const [reason] = await control<{ code: string }[]>`
          SELECT code FROM clans.legacy_import_rejections WHERE source_table = 'manifest'
        `
        expect(reason.code).toBe('source-manifest-changed')
      } finally {
        await control.end()
      }
    })

    await withFixtureDatabase(async (databaseUrl) => {
      expect(
        (
          await importLegacyRankings(databaseUrl, {
            batchSize: 1,
            maxBatches: 1,
          })
        ).status,
      ).toBe('in-progress')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.player SET name = 'Changed During Import' WHERE brawlhalla_id = 11`
        const blocked = await importLegacyRankings(databaseUrl)
        expect(blocked.status).toBe('blocked')
        const [progress] = await control<{ code: string }[]>`
          SELECT block_reason->>'code' AS code FROM rankings.legacy_import_progress
        `
        expect(progress.code).toBe('source-manifest-changed')
        expect((await importLegacyRankings(databaseUrl)).status).toBe('blocked')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('rejects synchronized player sets containing a non-positive contestant identity', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          INSERT INTO public.player
            (brawlhalla_id, name, region, rating, peak_rating, tier, ranked_games, ranked_wins,
             synced_at_1v1, rating_3v3, peak_rating_3v3, tier_3v3, wins_3v3, losses_3v3, synced_at_3v3)
          VALUES
            (-99, 'Invalid Identity', 'EU', 1700, 1750, 'Gold', 20, 10,
             '2026-08-01 10:07:00', 0, 0, NULL, 0, 0, NULL)
        `
        expect((await importLegacyRankings(databaseUrl)).status).toBe('complete')
        const [eu] = await control<
          Array<{ status: string; reasons: string[]; source_rows: number; candidate_rows: number }>
        >`
          SELECT status, reasons, source_row_count AS source_rows, candidate_row_count AS candidate_rows
          FROM rankings.legacy_import_sets WHERE mode = '1v1' AND scope = 'EU'
        `
        expect(eu).toEqual({
          status: 'rejected',
          reasons: ['contestant-identity-invalid'],
          source_rows: 3,
          candidate_rows: 2,
        })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('rejects every otherwise-valid set when a destination immutability trigger is replica-only', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          ALTER TABLE rankings.snapshot_rows ENABLE REPLICA TRIGGER rankings_snapshot_rows_prevent_truncate
        `
        const completed = await importLegacyRankings(databaseUrl)
        expect(completed.status).toBe('complete')
        expect(completed.reconciliation).toMatchObject({
          acceptedSets: 0,
          rejectedSets: 36,
          publishedModes: 0,
          publishedSnapshots: 0,
          exact: true,
        })
        const [eu] = await control<{ reasons: string[]; immutable: boolean }[]>`
          SELECT reasons, (gates->>'immutability')::boolean AS immutable
          FROM rankings.legacy_import_sets
          WHERE mode = '1v1' AND scope = 'EU'
        `
        expect(eu).toEqual({
          reasons: ['destination-immutability-unavailable'],
          immutable: false,
        })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('blocks Ranking writes before archiving when migration evidence immutability is unavailable', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          ALTER TABLE rankings.legacy_archive ENABLE REPLICA TRIGGER rankings_legacy_archive_immutable
        `
        const blocked = await importLegacyRankings(databaseUrl)
        expect(blocked.status).toBe('blocked')
        expect(blocked.reconciliation).toMatchObject({ archivedRows: 0, exact: false })
        const [progress] = await control<{ code: string }[]>`
          SELECT block_reason->>'code' AS code FROM rankings.legacy_import_progress
        `
        expect(progress.code).toBe('evidence-immutability-unavailable')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('blocks Clan writes when migration evidence immutability is unavailable', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          ALTER TABLE clans.legacy_archive ENABLE REPLICA TRIGGER clans_legacy_archive_immutable
        `
        const blocked = await importLegacyClans(databaseUrl)
        expect(blocked.status).toBe('blocked')
        expect(blocked.reconciliation).toMatchObject({
          archivedRows: 0,
          exact: false,
        })
        const [reason] = await control<{ code: string }[]>`
          SELECT code FROM clans.legacy_import_rejections WHERE source_table = 'manifest'
        `
        expect(reason.code).toBe('destination-immutability-unavailable')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('commits bounded Clan batches atomically and resumes after a crash', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control.unsafe(`
          CREATE FUNCTION clans.fail_second_clan_import() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.source_table = 'clan' AND NEW.source_key = '2' THEN
              RAISE EXCEPTION 'fixture clan crash';
            END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER fail_second_clan_import
          BEFORE INSERT ON clans.legacy_import_ledger
          FOR EACH ROW EXECUTE FUNCTION clans.fail_second_clan_import();
        `)
        await expect(importLegacyClans(databaseUrl, { batchSize: 1 })).rejects.toThrow('fixture clan crash')
        const [progress] = await control<{ last_clan_id: number; archived: number }[]>`
          SELECT last_clan_id,
                 (SELECT count(*)::integer FROM clans.legacy_archive) AS archived
          FROM clans.legacy_import_progress
        `
        expect(progress.last_clan_id).toBe(1)
        expect(progress.archived).toBeGreaterThan(0)
        await control`DROP TRIGGER fail_second_clan_import ON clans.legacy_import_ledger`
        await control`DROP FUNCTION clans.fail_second_clan_import()`
        expect((await importLegacyClans(databaseUrl, { batchSize: 1 })).status).toBe('complete')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('keeps completed Ranking modes independent and resumes after a crash', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control.unsafe(`
          CREATE FUNCTION rankings.fail_fixed_mode_import() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.mode = '2v2' AND NEW.scope = 'EU' THEN
              RAISE EXCEPTION 'fixture ranking crash';
            END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER fail_fixed_mode_import
          BEFORE INSERT ON rankings.legacy_import_sets
          FOR EACH ROW EXECUTE FUNCTION rankings.fail_fixed_mode_import();
        `)
        await expect(importLegacyRankings(databaseUrl)).rejects.toThrow('fixture ranking crash')
        const [published] = await control<{ modes: number }[]>`
          SELECT count(DISTINCT mode)::integer AS modes
          FROM rankings.generations WHERE source = 'v2-legacy' AND finalized
        `
        expect(published.modes).toBe(1)
        await control`DROP TRIGGER fail_fixed_mode_import ON rankings.legacy_import_sets`
        await control`DROP FUNCTION rankings.fail_fixed_mode_import()`
        const resumed = await importLegacyRankings(databaseUrl)
        expect(resumed.status).toBe('complete')
        expect(resumed.reconciliation.publishedModes).toBe(4)
      } finally {
        await control.end()
      }
    })
  }, 30_000)
})
