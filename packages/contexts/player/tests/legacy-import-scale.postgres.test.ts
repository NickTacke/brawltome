import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { importLegacyPlayers, playerMigrationInventory } from '../composition'
import { legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const databaseName = `bt_player_scale_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
    throw new Error(`Player scale tests require the dedicated server ${dedicatedServer}`)
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
      INSERT INTO public.player (brawlhalla_id, name, last_updated, last_viewed_at)
      SELECT identity, 'Scale Player ' || identity, '2026-08-01 10:00:00', '2026-08-01 10:00:00'
      FROM generate_series(1, 10001) AS identity
    `
    await setup`
      INSERT INTO public.player_alias (brawlhalla_id, key, value, created_at)
      SELECT identity, 'legacy', 'Alias ' || identity, '2026-08-01 10:00:00'
      FROM generate_series(1, 10001) AS identity
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

describe('Players V2 import scale', () => {
  scaleTest(
    'bulk imports more than one maximum player batch with exact fact and destination evidence',
    async () => {
      const first = await importLegacyPlayers(connectionString, { maxBatches: 1 })
      expect(first.status).toBe('in-progress')
      expect(first.checkpoint).toEqual({ stage: 'players', sourceKey: '10000' })

      const completed = await importLegacyPlayers(connectionString)
      expect(completed.status).toBe('complete')
      expect(completed.reconciliation).toMatchObject({
        sourceRows: 20002,
        archivedRows: 20002,
        transformedRows: 20002,
        semanticExact: true,
        exact: true,
      })
      expect(completed.reconciliation.unknownFacts).toBeGreaterThan(0)
    },
    600_000,
  )
})
