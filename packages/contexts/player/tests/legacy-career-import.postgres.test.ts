import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createPostgresCareerPlayers, importLegacyCareerSnapshots, playerMigrationInventory } from '../composition'
import { legacyPlayerRowsSql, legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
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
    throw new Error(`Legacy Career import tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
})

afterAll(async () => {
  await admin?.end()
})

async function withFixtureDatabase(run: (databaseUrl: string) => Promise<void>): Promise<void> {
  const databaseName = `bt_career_import_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  const client = postgres(databaseUrl.toString(), { max: 1 })
  try {
    await client.unsafe(legacyPlayerSchemaSql)
    for (const migration of playerMigrationInventory) await client.unsafe(migration.sql)
    await client.unsafe(legacyPlayerRowsSql)
    await run(databaseUrl.toString())
  } finally {
    await client.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  }
}

const quiesced = { legacyWritersQuiesced: true as const }

describe('compact V2 Career import', () => {
  test('requires quiesced writers and resumes bounded batches into immutable historical snapshots', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      await expect(importLegacyCareerSnapshots(databaseUrl)).rejects.toThrow('requires confirmed quiesced')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.player SET xp_percentage = 0.1 WHERE brawlhalla_id = 42`
        await control`UPDATE public.player_stats_legend SET xp_percentage = 0.1 WHERE brawlhalla_id = 42`
        await control`
          UPDATE public.player
          SET xp = 1, level = 1, xp_percentage = 0, total_games = 0, total_wins = 0,
              match_time_total = 0, damage_bomb = 0, damage_mine = 0, damage_spikeball = 0,
              damage_sidekick = 0, hit_snowball = 0, ko_bomb = 0, ko_mine = 0,
              ko_spikeball = 0, ko_sidekick = 0, ko_snowball = 0,
              stats_last_updated = '2026-08-02T09:00:00'
          WHERE brawlhalla_id = 43
        `

        const first = await importLegacyCareerSnapshots(databaseUrl, { ...quiesced, batchSize: 1, maxBatches: 1 })
        expect(first).toMatchObject({
          status: 'in-progress',
          checkpoint: 42,
          reconciliation: { sourceRows: 2, archivedRows: 1, importedRows: 1, exact: false },
        })

        const completed = await importLegacyCareerSnapshots(databaseUrl, { ...quiesced, batchSize: 1 })
        expect(completed).toMatchObject({
          status: 'complete',
          checkpoint: null,
          reconciliation: {
            sourceRows: 2,
            archivedRows: 2,
            importedRows: 2,
            rejectedRows: 0,
            sourceExact: true,
            destinationExact: true,
            exact: true,
          },
        })
        expect(await importLegacyCareerSnapshots(databaseUrl, quiesced)).toEqual(completed)

        const career = createPostgresCareerPlayers(databaseUrl)
        try {
          await expect(career.byId(42)).resolves.toMatchObject({
            checkedAt: new Date('2026-08-01T09:00:00Z'),
            lastSuccessAt: new Date('2026-08-01T09:00:00Z'),
            snapshotSource: 'legacy-v2',
            freshness: 'stale',
            snapshot: {
              guild: { guildId: 7, guildName: 'Legacy Clan' },
              account: { xp: 5000, level: 10, xpPercentage: Math.fround(0.1) },
              combat: { games: 200, wins: 100, damageBomb: '9007199254740993', bombKos: 10 },
              legends: [
                expect.objectContaining({
                  legendId: 3,
                  legendNameKey: 'bodvar',
                  xp: 3000,
                  xpPercentage: Math.fround(0.1),
                }),
              ],
              weapons: [{ weapon: 'Hammer', heldTime: 500, damage: '20000', kos: 40 }],
            },
          })
        } finally {
          await career.close()
        }

        const [evidence] = await control<
          Array<{
            compact: number
            full_archive: number
            full_facts: number
            exact_checksum: boolean
            guild_name: string
          }>
        >`
          SELECT (SELECT count(*)::integer FROM players.legacy_career_archive) AS compact,
                 (SELECT count(*)::integer FROM players.legacy_archive) AS full_archive,
                 (SELECT count(*)::integer FROM players.legacy_facts) AS full_facts,
                 bool_and(source_checksum = encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex'))
                   AS exact_checksum,
                 max(snapshot->'guild'->>'clan_name') AS guild_name
          FROM players.legacy_career_archive
        `
        expect(evidence).toEqual({
          compact: 2,
          full_archive: 0,
          full_facts: 0,
          exact_checksum: true,
          guild_name: 'Legacy Clan',
        })
        await expect(
          Promise.resolve(control`UPDATE players.legacy_career_archive SET snapshot = '{}' WHERE brawlhalla_id = 42`),
        ).rejects.toThrow('Players legacy archive is immutable')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('never overwrites a canonical Career success', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`
          INSERT INTO players.career_profiles
            (brawlhalla_id, player_name, checked_at, last_success_at, xp, level, xp_percentage,
             games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
             snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
          VALUES
            (42, 'Canonical', '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z', 1, 1, 0,
             1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
        `
        await expect(importLegacyCareerSnapshots(databaseUrl, quiesced)).resolves.toMatchObject({
          status: 'complete',
          reconciliation: { importedRows: 0, exact: true },
        })
        const [profile] = await control<{ player_name: string; snapshot_source: string }[]>`
          SELECT player_name, snapshot_source FROM players.career_profiles WHERE brawlhalla_id = 42
        `
        expect(profile).toEqual({ player_name: 'Canonical', snapshot_source: 'v0-player-snapshot' })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('archives and rejects invalid children without publishing a partial snapshot', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.player_stats_legend SET wins = games + 1 WHERE brawlhalla_id = 42`
        await expect(importLegacyCareerSnapshots(databaseUrl, quiesced)).resolves.toMatchObject({
          status: 'complete',
          reconciliation: { sourceRows: 1, archivedRows: 1, importedRows: 0, rejectedRows: 1, exact: true },
        })
        const [evidence] = await control<{ archived: number; code: string }[]>`
          SELECT count(*)::integer AS archived, rejection.code
          FROM players.legacy_career_archive archive
          JOIN players.legacy_career_import_rejections rejection USING (brawlhalla_id)
          GROUP BY rejection.code
        `
        expect(evidence).toEqual({ archived: 1, code: 'canonical-constraints' })
        await expect(
          Promise.resolve(
            control`UPDATE players.legacy_career_import_rejections SET code = 'forged' WHERE brawlhalla_id = 42`,
          ),
        ).rejects.toThrow('Players legacy archive is immutable')
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('archives and rejects a non-positive source identity without wedging progress', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control.begin(async (transaction) => {
          const sql = transaction as unknown as ReturnType<typeof postgres>
          await sql`SELECT set_config('players.suppress_discovery_outbox', 'on', true)`
          await sql`
            INSERT INTO public.player
              (brawlhalla_id, name, xp, level, xp_percentage, total_games, total_wins, match_time_total,
               damage_bomb, damage_mine, damage_spikeball, damage_sidekick, hit_snowball,
               ko_bomb, ko_mine, ko_spikeball, ko_sidekick, ko_snowball, stats_last_updated)
            VALUES (-1, 'Malformed', 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '2026-08-01T00:00:00')
          `
        })
        await expect(importLegacyCareerSnapshots(databaseUrl, quiesced)).resolves.toMatchObject({
          status: 'complete',
          reconciliation: { sourceRows: 2, archivedRows: 2, importedRows: 1, rejectedRows: 1, exact: true },
        })
        const [rejection] = await control<{ brawlhalla_id: number; code: string }[]>`
          SELECT brawlhalla_id, code FROM players.legacy_career_import_rejections WHERE brawlhalla_id = -1
        `
        expect(rejection).toEqual({ brawlhalla_id: -1, code: 'canonical-constraints' })
      } finally {
        await control.end()
      }
    })
  }, 30_000)

  test('blocks when compact source or an imported destination drifts', async () => {
    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyCareerSnapshots(databaseUrl, quiesced)).status).toBe('complete')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE players.career_legends SET damage_dealt = damage_dealt + 1 WHERE brawlhalla_id = 42`
        const destinationDrift = await importLegacyCareerSnapshots(databaseUrl, quiesced)
        expect(destinationDrift).toMatchObject({
          status: 'blocked',
          reconciliation: { sourceExact: true, destinationExact: false, exact: false },
        })
        await control`UPDATE players.career_legends SET damage_dealt = damage_dealt - 1 WHERE brawlhalla_id = 42`
        await expect(importLegacyCareerSnapshots(databaseUrl, quiesced)).resolves.toMatchObject({
          status: 'complete',
          reconciliation: { exact: true },
        })
      } finally {
        await control.end()
      }
    })

    await withFixtureDatabase(async (databaseUrl) => {
      expect((await importLegacyCareerSnapshots(databaseUrl, quiesced)).status).toBe('complete')
      const control = postgres(databaseUrl, { max: 1 })
      try {
        await control`UPDATE public.player SET damage_bomb = damage_bomb + 1 WHERE brawlhalla_id = 42`
        const sourceDrift = await importLegacyCareerSnapshots(databaseUrl, quiesced)
        expect(sourceDrift).toMatchObject({
          status: 'blocked',
          reconciliation: { sourceExact: false, destinationExact: true, exact: false },
        })
        await control`UPDATE public.player SET damage_bomb = damage_bomb - 1 WHERE brawlhalla_id = 42`
        await expect(importLegacyCareerSnapshots(databaseUrl, quiesced)).resolves.toMatchObject({
          status: 'complete',
          reconciliation: { exact: true },
        })
      } finally {
        await control.end()
      }
    })
  }, 30_000)
})
