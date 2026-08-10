import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import {
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  importLegacyPlayers,
  playerMigrationInventory,
} from '../composition'
import { legacyPlayerRowsSql, legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `bt_player_import_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

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
    throw new Error(`Player migration tests require the dedicated server ${dedicatedServer}`)
  }

  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()

  const setup = postgres(connectionString, { max: 1 })
  try {
    await setup.unsafe(legacyPlayerSchemaSql)
    for (const migration of playerMigrationInventory) await setup.unsafe(migration.sql)
    await setup.unsafe(legacyPlayerRowsSql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function withFixtureDatabase(run: (databaseUrl: string) => Promise<void>): Promise<void> {
  const isolatedName = `bt_player_import_case_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${isolatedName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${isolatedName}`
  const client = postgres(databaseUrl.toString(), { max: 1 })
  try {
    await client.unsafe(legacyPlayerSchemaSql)
    for (const migration of playerMigrationInventory) await client.unsafe(migration.sql)
    await client.unsafe(legacyPlayerRowsSql)
    await run(databaseUrl.toString())
  } finally {
    await client.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`)
  }
}

describe('Players V2 import', () => {
  test('resumes bounded batches and reconciles checksummed raw rows, unknown zeros, identities, and ordered history', async () => {
    const first = await importLegacyPlayers(connectionString, { batchSize: 1, maxBatches: 1 })
    expect(first.status).toBe('in-progress')
    expect(first.checkpoint).toEqual({ stage: 'players', sourceKey: '42' })

    const [completed, concurrent] = await Promise.all([
      importLegacyPlayers(connectionString, { batchSize: 1 }),
      importLegacyPlayers(connectionString, { batchSize: 1 }),
    ])
    expect(completed.status).toBe('complete')
    expect(concurrent.status).toBe('complete')
    expect(completed.reconciliation.exact).toBe(true)
    expect(completed.reconciliation.semanticExact).toBe(true)
    expect(completed.reconciliation.sourceChecksum).toBe(completed.reconciliation.archiveChecksum)
    expect(await importLegacyPlayers(connectionString)).toEqual(completed)

    const inspect = postgres(connectionString)
    try {
      const archives = await inspect<
        Array<{ source_table: string; source_key: string; row_checksum: string; raw_row: Record<string, unknown> }>
      >`
        SELECT source_table, source_key, row_checksum, raw_row
        FROM players.legacy_archive
        ORDER BY source_table, source_key
      `
      expect(archives).toHaveLength(completed.reconciliation.sourceRows)
      expect(archives.every(({ row_checksum }) => /^[a-f0-9]{64}$/.test(row_checksum))).toBe(true)
      expect(
        archives.find(({ source_table, source_key }) => source_table === 'player' && source_key === '42')?.raw_row,
      ).toMatchObject({ brawlhalla_id: 42, name: 'Legacy | Forty Two', rating: 0 })

      const zeroFacts = await inspect<
        Array<{ fact_key: string; value: unknown; outcome: string; reason: string | null }>
      >`
        SELECT fact_key, value, outcome, reason
        FROM players.legacy_facts
        WHERE source_table = 'player' AND source_key = '42' AND fact_key IN ('rating', 'match_time_total')
        ORDER BY fact_key
      `
      expect([...zeroFacts]).toEqual([
        { fact_key: 'match_time_total', value: null, outcome: 'unknown', reason: 'legacy-default-zero-unproven' },
        { fact_key: 'rating', value: 0, outcome: 'known', reason: null },
      ])
      const [precision] = await inspect<
        Array<{ archived_damage: string; fact_damage: string; rating_observed_at: Date }>
      >`
        SELECT archive.raw_row->>'damage_bomb' AS archived_damage,
               fact.value #>> '{}' AS fact_damage,
               rating.observed_at AS rating_observed_at
        FROM players.legacy_archive archive
        JOIN players.legacy_facts fact
          ON fact.source_table = archive.source_table AND fact.source_key = archive.source_key
         AND fact.fact_key = 'damage_bomb'
        JOIN players.legacy_facts rating
          ON rating.source_table = archive.source_table AND rating.source_key = archive.source_key
         AND rating.fact_key = 'rating'
        WHERE archive.source_table = 'player' AND archive.source_key = '42'
      `
      expect(precision).toEqual({
        archived_damage: '9007199254740993',
        fact_damage: '9007199254740993',
        rating_observed_at: new Date('2026-08-01T11:00:00Z'),
      })
      const scopes = await inspect<Array<{ source_table: string; fact_key: string; scope: string; outcome: string }>>`
        SELECT source_table, fact_key, scope, outcome
        FROM players.legacy_facts
        WHERE (source_table = 'player' AND brawlhalla_id = 43 AND fact_key = 'wins_3v3')
           OR (source_table = 'player_ranked_team' AND brawlhalla_id = 42 AND fact_key = 'wins')
           OR (source_table = 'player_ranked_legend' AND brawlhalla_id = 43 AND fact_key = 'wins')
        ORDER BY source_table
      `
      expect([...scopes]).toEqual([
        { source_table: 'player', fact_key: 'wins_3v3', scope: 'current-season:3v3', outcome: 'known' },
        { source_table: 'player_ranked_legend', fact_key: 'wins', scope: 'current-season:1v1', outcome: 'known' },
        { source_table: 'player_ranked_team', fact_key: 'wins', scope: 'current-season:solo-2v2', outcome: 'known' },
      ])

      const [valhallan] = await inspect<Array<{ scope: string; observed_at: Date }>>`
        SELECT scope, observed_at
        FROM players.legacy_facts
        WHERE source_table = 'player' AND source_key = '42' AND fact_key = 'valhallan_confirmed_at'
      `
      expect(valhallan).toEqual({ scope: 'current-season:1v1', observed_at: new Date('2026-08-01T11:00:00Z') })

      const history = await inspect<
        Array<{
          legacy_source_key: string | null
          source_order: string | null
          rating: number
          wins: number
          recorded_at: Date
        }>
      >`
        SELECT legacy_source_key, source_order, rating, wins, recorded_at
        FROM players.ranked_rating_history
        WHERE brawlhalla_id = 42
        ORDER BY recorded_at DESC, source_order DESC NULLS LAST, id DESC
      `
      expect([...history]).toEqual([
        {
          legacy_source_key: '101',
          source_order: '101',
          rating: 1600,
          wins: 1,
          recorded_at: new Date('2026-07-01T00:00:00Z'),
        },
        {
          legacy_source_key: '100',
          source_order: '100',
          rating: 1500,
          wins: 0,
          recorded_at: new Date('2026-07-01T00:00:00Z'),
        },
      ])
      const [rejection] = await inspect<{ code: string; source_key: string }[]>`
        SELECT code, source_key FROM players.legacy_import_rejections WHERE source_table = 'rating_history'
      `
      expect(rejection).toEqual({ code: 'history-tier-unavailable', source_key: '102' })

      const source = createPostgresPlayerDiscoverySource(connectionString)
      try {
        const facts = await source.snapshot()
        expect(facts.facts).toContainEqual(
          expect.objectContaining({
            brawlhallaId: 42,
            name: 'Legacy | Forty Two',
            rating: null,
            viewCount: 9,
            aliases: ['Former Name'],
          }),
        )
      } finally {
        await source.close()
      }

      await expect(
        Promise.resolve(
          inspect`UPDATE players.legacy_archive SET raw_row = '{}'::jsonb WHERE source_table = 'player' AND source_key = '42'`,
        ),
      ).rejects.toThrow('Players legacy archive is immutable')
      await expect(Promise.resolve(inspect`TRUNCATE players.legacy_archive CASCADE`)).rejects.toThrow(
        'Players legacy archive is immutable',
      )

      await inspect`
        UPDATE players.ranked_profiles
        SET player_name = 'Fresh V0', checked_at = '2026-08-03T00:00:00Z', last_success_at = '2026-08-03T00:00:00Z',
            region = 'US-E', rating = 1900, peak_rating = 1950, tier = 'Diamond', wins = 60, games = 110
        WHERE brawlhalla_id = 42
      `
      await inspect`
        INSERT INTO players.ranked_rating_history
          (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
        VALUES (42, 1900, 1950, 'Diamond', 60, 110, '2026-08-03T00:00:00Z')
      `
      expect(await importLegacyPlayers(connectionString)).toEqual(completed)
      const ranked = createPostgresRankedPlayers(connectionString)
      try {
        const profile = await ranked.byId(42)
        expect(profile?.snapshot?.oneVsOne.rating).toBe(1900)
        expect(profile?.snapshot?.ratingHistory.map(({ rating, source }) => ({ rating, source }))).toEqual([
          { rating: 1900, source: 'v0-player-snapshot' },
          { rating: 1600, source: 'legacy-v2' },
          { rating: 1500, source: 'legacy-v2' },
        ])
      } finally {
        await ranked.close()
      }
    } finally {
      await inspect.end()
    }
  }, 30_000)

  test('blocks completion when fact semantics or imported Discovery destinations drift', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyPlayers(databaseUrl)).status).toBe('complete')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          UPDATE players.legacy_facts SET scope = 'wrong-scope'
          WHERE source_table = 'player' AND source_key = '42' AND fact_key = 'rating'
        `
        const factDrift = await importLegacyPlayers(databaseUrl)
        expect(factDrift.status).toBe('blocked')
        expect(factDrift.reconciliation.semanticExact).toBe(false)

        await control`
          UPDATE players.legacy_facts SET scope = provenance->>'scope'
          WHERE source_table = 'player' AND source_key = '42' AND fact_key = 'rating'
        `
        expect((await importLegacyPlayers(databaseUrl)).status).toBe('complete')

        await control`
          UPDATE players.legacy_discovery_profiles SET player_name = 'Corrupted'
          WHERE brawlhalla_id = 42
        `
        const destinationDrift = await importLegacyPlayers(databaseUrl)
        expect(destinationDrift.status).toBe('blocked')
        expect(destinationDrift.reconciliation.semanticExact).toBe(false)
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('detects a forged archive row even when its stored content hash and fact agree', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyPlayers(databaseUrl)).status).toBe('complete')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`ALTER TABLE players.legacy_archive DISABLE TRIGGER players_legacy_archive_immutable`
        await control`
          UPDATE players.legacy_archive
          SET raw_row = jsonb_set(raw_row, '{refresh_tier}', '"forged"'::jsonb)
          WHERE source_table = 'player' AND source_key = '42'
        `
        await control`
          UPDATE players.legacy_archive
          SET content_checksum = encode(sha256(convert_to(raw_row::text, 'UTF8')), 'hex')
          WHERE source_table = 'player' AND source_key = '42'
        `
        await control`ALTER TABLE players.legacy_archive ENABLE TRIGGER players_legacy_archive_immutable`
        await control`
          UPDATE players.legacy_facts SET value = '"forged"'::jsonb
          WHERE source_table = 'player' AND source_key = '42' AND fact_key = 'refresh_tier'
        `
        const blocked = await importLegacyPlayers(databaseUrl)
        expect(blocked.status).toBe('blocked')
        expect(blocked.reconciliation.semanticExact).toBe(false)
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('archives and rejects the minimum PostgreSQL integer identity without skipping it', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control.begin(async (transaction) => {
          const sql = transaction as unknown as ReturnType<typeof postgres>
          await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
          await sql`
            INSERT INTO public.player (brawlhalla_id, name, last_updated, last_viewed_at)
            VALUES (-2147483648, 'Invalid Minimum', '2026-08-03T00:00:00', '2026-08-03T00:00:00')
          `
        })
        const completed = await importLegacyPlayers(databaseUrl)
        expect(completed.status).toBe('complete')
        expect(completed.reconciliation.exact).toBe(true)
        const [evidence] = await control<{ archived: boolean; code: string }[]>`
          SELECT EXISTS (
                   SELECT 1 FROM players.legacy_archive
                   WHERE source_table = 'player' AND source_key = '-2147483648'
                 ) AS archived,
                 rejection.code
          FROM players.legacy_import_rejections rejection
          WHERE rejection.source_table = 'player' AND rejection.source_key = '-2147483648'
        `
        expect(evidence).toEqual({ archived: true, code: 'player-identity-invalid' })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('suppresses row triggers and enqueues one Discovery version per imported batch', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`TRUNCATE players.discovery_outbox`
        await control`UPDATE players.discovery_state SET source_version = 0 WHERE singleton`
        expect((await importLegacyPlayers(databaseUrl)).status).toBe('complete')
        const [outbox] = await control<
          Array<{ events: number; identities: number; versions: number; source_version: string }>
        >`
          SELECT count(*)::integer AS events,
                 count(DISTINCT brawlhalla_id)::integer AS identities,
                 count(DISTINCT source_version)::integer AS versions,
                 (SELECT source_version FROM players.discovery_state WHERE singleton) AS source_version
          FROM players.discovery_outbox
        `
        expect(outbox).toEqual({ events: 2, identities: 2, versions: 1, source_version: '1' })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('commits each batch atomically and resumes after a database failure', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control.unsafe(`
          CREATE FUNCTION players.fail_second_player_import() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.source_table = 'player' AND NEW.source_key = '43' THEN
              RAISE EXCEPTION 'fixture crash';
            END IF;
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER fail_second_player_import
          BEFORE INSERT ON players.legacy_import_ledger
          FOR EACH ROW EXECUTE FUNCTION players.fail_second_player_import();
        `)
        await expect(importLegacyPlayers(databaseUrl, { batchSize: 1 })).rejects.toThrow('fixture crash')
        const [checkpoint] = await control<{ last_player_id: number; archived: number }[]>`
          SELECT progress.last_player_id,
                 (SELECT count(*)::integer FROM players.legacy_archive) AS archived
          FROM players.legacy_import_progress progress
        `
        expect(checkpoint.last_player_id).toBe(42)
        expect(checkpoint.archived).toBeGreaterThan(0)
        await control`DROP TRIGGER fail_second_player_import ON players.legacy_import_ledger`
        await control`DROP FUNCTION players.fail_second_player_import()`

        const resumed = await importLegacyPlayers(databaseUrl, { batchSize: 1 })
        expect(resumed.status).toBe('complete')
        expect(resumed.reconciliation.exact).toBe(true)
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('blocks resume with evidence when the frozen V2 source changes', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyPlayers(databaseUrl, { batchSize: 1, maxBatches: 1 })).status).toBe('in-progress')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.player SET name = 'Changed During Import' WHERE brawlhalla_id = 43`
        const blocked = await importLegacyPlayers(databaseUrl, { batchSize: 1 })
        expect(blocked.status).toBe('blocked')
        expect(blocked.reconciliation.exact).toBe(false)
        const [evidence] = await control<{ code: string }[]>`
          SELECT code FROM players.legacy_import_rejections WHERE source_table = 'manifest'
        `
        expect(evidence.code).toBe('source-manifest-changed')
      } finally {
        await control.end()
      }
    })
  }, 30_000)
})
