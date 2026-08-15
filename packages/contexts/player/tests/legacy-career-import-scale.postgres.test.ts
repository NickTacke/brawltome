import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { importLegacyCareerSnapshots, playerMigrationInventory } from '../composition'
import { legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const databaseName = `bt_career_scale_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
const scaleTest = process.env.RUN_MIGRATION_SCALE_TESTS === '1' ? test : test.skip
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  if (process.env.RUN_MIGRATION_SCALE_TESTS !== '1') return
  const configured = new URL(process.env.DATABASE_URL ?? '')
  const dedicated = new URL(dedicatedServer)
  if (
    configured.hostname !== dedicated.hostname ||
    configured.port !== dedicated.port ||
    configured.username !== dedicated.username ||
    configured.password !== dedicated.password
  ) {
    throw new Error(`Legacy Career scale tests require the dedicated server ${dedicatedServer}`)
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
    await setup`
      INSERT INTO public.player
        (brawlhalla_id, name, xp, level, xp_percentage, total_games, total_wins, match_time_total,
         damage_bomb, damage_mine, damage_spikeball, damage_sidekick, hit_snowball,
         ko_bomb, ko_mine, ko_spikeball, ko_sidekick, ko_snowball,
         stats_last_updated, last_updated, last_viewed_at)
      SELECT identity, 'Scale Player ' || identity, 100, 2, 0.5, 100, 50, 6000,
             1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
             '2026-08-01 10:00:00', '2026-08-01 10:00:00', '2026-08-01 10:00:00'
      FROM generate_series(1, 1001) AS identity
    `
    await setup`
      INSERT INTO public.player_stats_legend
        (brawlhalla_id, legend_id, legend_name_key, xp, level, xp_percentage, games, wins,
         match_time, kos, team_kos, suicides, falls, damage_dealt, damage_taken,
         damage_weapon_one, damage_weapon_two, time_held_weapon_one, time_held_weapon_two,
         ko_weapon_one, ko_weapon_two, ko_unarmed, ko_thrown_item, ko_gadgets,
         damage_unarmed, damage_thrown_item, damage_gadgets)
      SELECT player_id, legend_id, 'legend-' || legend_id, 100, 2, 0.5, 10, 5,
             60, 5, 0, 0, 5, 100, 100, 50, 50, 30, 30, 2, 3, 1, 0, 0, 10, 0, 0
      FROM generate_series(1, 1001) AS player_id
      CROSS JOIN generate_series(1, 60) AS legend_id
    `
    await setup`
      INSERT INTO public.player_weapon_stat (brawlhalla_id, weapon, time_held, damage, kos)
      SELECT identity, 'Hammer', 100, 200, 5 FROM generate_series(1, 1001) AS identity
    `
  } finally {
    await setup.end()
  }
}, 120_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
}, 120_000)

describe('compact V2 Career import scale', () => {
  scaleTest(
    'archives and materializes more than one default batch with dense legend collections',
    async () => {
      const first = await importLegacyCareerSnapshots(connectionString, {
        legacyWritersQuiesced: true,
        maxBatches: 1,
      })
      expect(first).toMatchObject({ status: 'in-progress', checkpoint: 1000 })

      const completed = await importLegacyCareerSnapshots(connectionString, { legacyWritersQuiesced: true })
      expect(completed).toMatchObject({
        status: 'complete',
        reconciliation: {
          sourceRows: 1001,
          archivedRows: 1001,
          importedRows: 1001,
          rejectedRows: 0,
          sourceExact: true,
          destinationExact: true,
          exact: true,
        },
      })
    },
    600_000,
  )
})
