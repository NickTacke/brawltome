import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { importLegacyReferenceHistory, playerMigrationInventory } from '../composition'
import { legacyPlayerRowsSql, legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
let admin: ReturnType<typeof postgres>

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
    throw new Error(`Legacy reference import tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
})

afterAll(async () => {
  await admin?.end()
})

async function withFixtureDatabase(
  run: (databaseUrl: string, client: ReturnType<typeof postgres>) => Promise<void>,
  migrations: readonly { sql: string }[] = playerMigrationInventory,
) {
  const databaseName = `bt_reference_import_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  const client = postgres(databaseUrl.toString(), { max: 1 })
  try {
    await client.unsafe(legacyPlayerSchemaSql)
    for (const migration of migrations) await client.unsafe(migration.sql)
    await client.unsafe(legacyPlayerRowsSql)
    await run(databaseUrl.toString(), client)
  } finally {
    await client.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  }
}

const quiesced = { legacyWritersQuiesced: true as const }

describe('compact V2 Player reference-history import', () => {
  test('resumes from immutable ledger evidence and preserves aliases, nullable tiers, and canonical ranked state', async () => {
    await withFixtureDatabase(async (databaseUrl, client) => {
      await expect(importLegacyReferenceHistory(databaseUrl)).rejects.toThrow('requires confirmed quiesced')
      await client`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (42, 'Canonical Forty Two', '2026-08-10', '2026-08-10', 'US-E', 2000, 2100, 'Diamond', 60, 120)
      `

      const first = await importLegacyReferenceHistory(databaseUrl, { ...quiesced, batchSize: 1, maxBatches: 1 })
      expect(first).toMatchObject({
        status: 'in-progress',
        checkpoint: { stage: 'player_alias' },
        reconciliation: { sourceRows: 5, archivedRows: 1, importedAliases: 1, importedHistory: 0 },
      })

      const completed = await importLegacyReferenceHistory(databaseUrl, { ...quiesced, batchSize: 1 })
      expect(completed).toEqual({
        status: 'complete',
        checkpoint: null,
        reconciliation: {
          sourceRows: 5,
          archivedRows: 5,
          importedAliases: 1,
          importedHistory: 4,
          rejectedRows: 0,
          sourceExact: true,
          destinationExact: true,
          exact: true,
        },
      })
      expect(await importLegacyReferenceHistory(databaseUrl, quiesced)).toEqual(completed)

      const [profile] = await client<
        Array<{ player_name: string; last_success_at: Date; rating: number; tier: string }>
      >`
        SELECT player_name, last_success_at, rating, tier
        FROM players.ranked_profiles WHERE brawlhalla_id = 42
      `
      expect(profile).toMatchObject({
        player_name: 'Canonical Forty Two',
        last_success_at: new Date('2026-08-10T00:00:00Z'),
        rating: 2000,
        tier: 'Diamond',
      })
      const history = await client<Array<{ legacy_source_key: string; tier: string | null }>>`
        SELECT legacy_source_key, tier FROM players.ranked_rating_history
        WHERE history_source = 'v2-legacy' ORDER BY source_order
      `
      expect([...history]).toEqual([
        { legacy_source_key: '100', tier: 'Gold 1' },
        { legacy_source_key: '101', tier: 'Gold 2' },
        { legacy_source_key: '102', tier: null },
        { legacy_source_key: '103', tier: 'Diamond' },
      ])
      await expect(
        Promise.resolve(client`UPDATE players.legacy_discovery_aliases SET display_alias = 'changed'`),
      ).rejects.toThrow('Players legacy archive is immutable')
      await expect(
        Promise.resolve(client`DELETE FROM players.legacy_import_ledger WHERE source_table = 'player_alias'`),
      ).rejects.toThrow('Players legacy archive is immutable')
    })
  }, 60_000)

  test('archives malformed identities, rejects alias collisions, and self-heals after restored source drift', async () => {
    await withFixtureDatabase(async (databaseUrl, client) => {
      await client`SELECT set_config('players.suppress_discovery_outbox', 'on', false)`
      await client`
        INSERT INTO public.player (brawlhalla_id, name, last_updated, last_viewed_at)
        VALUES (-1, 'Malformed', '2026-08-01', '2026-08-01')
      `
      await client`
        INSERT INTO public.player_alias (brawlhalla_id, key, value, created_at) VALUES
          (-1, 'invalid', 'Invalid Identity', '2026-08-01'),
          (42, 'collision', 'former name', '2026-07-02')
      `
      await client`
        INSERT INTO public.rating_history
          (id, brawlhalla_id, rating, peak_rating, tier, games, wins, recorded_at)
        VALUES (104, -1, 1500, 1600, 'Gold', 10, 5, '2026-08-01')
      `
      await client`SELECT set_config('players.suppress_discovery_outbox', 'off', false)`

      const completed = await importLegacyReferenceHistory(databaseUrl, quiesced)
      expect(completed).toMatchObject({
        status: 'complete',
        reconciliation: {
          sourceRows: 8,
          archivedRows: 8,
          importedAliases: 1,
          importedHistory: 4,
          rejectedRows: 3,
          sourceExact: true,
          destinationExact: true,
          exact: true,
        },
      })
      const rejections = await client<Array<{ source_table: string; code: string }>>`
        SELECT source_table, code FROM players.legacy_import_rejections
        WHERE source_table IN ('player_alias', 'rating_history')
        ORDER BY source_table, code
      `
      expect([...rejections]).toEqual([
        { source_table: 'player_alias', code: 'alias-identity-invalid' },
        { source_table: 'player_alias', code: 'alias-normalization-collision' },
        { source_table: 'rating_history', code: 'history-values-invalid' },
      ])

      await client`
        UPDATE public.player_alias SET value = 'Drifted Name'
        WHERE brawlhalla_id = 42 AND key = 'former'
      `
      const blocked = await importLegacyReferenceHistory(databaseUrl, quiesced)
      expect(blocked).toMatchObject({
        status: 'blocked',
        reconciliation: { sourceExact: false, destinationExact: true, exact: false },
      })
      await client`
        UPDATE public.player_alias SET value = 'Former Name'
        WHERE brawlhalla_id = 42 AND key = 'former'
      `
      await expect(importLegacyReferenceHistory(databaseUrl, quiesced)).resolves.toMatchObject({
        status: 'complete',
        reconciliation: { sourceExact: true, destinationExact: true, exact: true },
      })
    })
  }, 60_000)

  test('reclassifies prior null-tier rejection evidence while retaining granular malformed-history evidence', async () => {
    await withFixtureDatabase(
      async (databaseUrl, client) => {
        await client`SELECT set_config('players.suppress_discovery_outbox', 'on', false)`
        await client`
          INSERT INTO public.player (brawlhalla_id, name, last_updated, last_viewed_at)
          VALUES (-1, 'Malformed', '2026-08-01', '2026-08-01')
        `
        await client`
          INSERT INTO public.rating_history
            (id, brawlhalla_id, rating, peak_rating, tier, games, wins, recorded_at)
          VALUES (104, -1, 1500, 1600, 'Gold', 10, 5, '2026-08-01')
        `
        await client`SELECT set_config('players.suppress_discovery_outbox', 'off', false)`
        await client`
          INSERT INTO players.legacy_archive
            (source_table, source_key, brawlhalla_id, raw_row, row_checksum, content_checksum)
          SELECT 'rating_history', source.id::text, source.brawlhalla_id, to_jsonb(source),
                 encode(sha256(convert_to(to_jsonb(source)::text, 'UTF8')), 'hex'),
                 encode(sha256(convert_to(to_jsonb(source)::text, 'UTF8')), 'hex')
          FROM public.rating_history source WHERE source.id IN (102, 104)
        `
        await client`
          INSERT INTO players.legacy_import_ledger
            (source_table, source_key, archive_checksum, outcome)
          SELECT source_table, source_key, row_checksum, 'rejected'
          FROM players.legacy_archive
          WHERE source_table = 'rating_history' AND source_key IN ('102', '104')
        `
        await client`
          INSERT INTO players.legacy_import_rejections
            (source_table, source_key, code, evidence, archive_checksum)
          SELECT source_table, source_key,
                 CASE source_key WHEN '102' THEN 'history-tier-unavailable'
                                 ELSE 'history-player-identity-invalid' END,
                 raw_row, row_checksum
          FROM players.legacy_archive
          WHERE source_table = 'rating_history' AND source_key IN ('102', '104')
        `

        await client.unsafe(playerMigrationInventory[12].sql)
        const completed = await importLegacyReferenceHistory(databaseUrl, quiesced)
        expect(completed).toEqual({
          status: 'complete',
          checkpoint: null,
          reconciliation: {
            sourceRows: 6,
            archivedRows: 6,
            importedAliases: 1,
            importedHistory: 4,
            rejectedRows: 1,
            sourceExact: true,
            destinationExact: true,
            exact: true,
          },
        })
        const [nullableTier] = await client<{ tier: string | null }[]>`
          SELECT tier FROM players.ranked_rating_history
          WHERE history_source = 'v2-legacy' AND legacy_source_key = '102'
        `
        expect(nullableTier).toEqual({ tier: null })
        const [retained] = await client<{ code: string }[]>`
          SELECT code FROM players.legacy_import_rejections
          WHERE source_table = 'rating_history' AND source_key = '104'
        `
        expect(retained).toEqual({ code: 'history-player-identity-invalid' })
      },
      playerMigrationInventory.slice(0, -1),
    )
  }, 60_000)
})
