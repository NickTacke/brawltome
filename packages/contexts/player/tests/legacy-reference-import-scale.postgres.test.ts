import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { importLegacyReferenceHistory, playerMigrationInventory } from '../composition'
import { legacyPlayerSchemaSql } from './fixtures/legacy-player-migration'

const dedicatedServer = 'postgres://brawltome_v3:brawltome_v3@127.0.0.1:55436'
const databaseName = `bt_reference_scale_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
    throw new Error(`Player reference-history scale tests require the dedicated server ${dedicatedServer}`)
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
    await setup`SELECT set_config('players.suppress_discovery_outbox', 'on', false)`
    await setup`
      INSERT INTO public.player (brawlhalla_id, name, last_updated, last_viewed_at)
      SELECT identity, 'Scale Player ' || identity, '2026-08-01', '2026-08-01'
      FROM generate_series(1, 1001) AS identity
    `
    await setup`
      INSERT INTO public.player_alias (brawlhalla_id, key, value, created_at)
      SELECT identity, 'legacy', 'Alias ' || identity, '2026-08-01'
      FROM generate_series(1, 1001) AS identity
    `
    await setup`
      INSERT INTO public.rating_history
        (id, brawlhalla_id, rating, peak_rating, tier, games, wins, recorded_at)
      SELECT identity, identity, 1500, 1600,
             CASE WHEN identity % 10 = 0 THEN NULL ELSE 'Gold' END,
             10, 5, '2026-08-01'
      FROM generate_series(1, 1001) AS identity
    `
    await setup`SELECT set_config('players.suppress_discovery_outbox', 'off', false)`
  } finally {
    await setup.end()
  }
}, 120_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
}, 120_000)

describe('compact V2 Player reference-history scale', () => {
  scaleTest(
    'resumes across alias and history batches with exact evidence',
    async () => {
      const first = await importLegacyReferenceHistory(connectionString, {
        legacyWritersQuiesced: true,
        batchSize: 100,
        maxBatches: 1,
      })
      expect(first).toMatchObject({
        status: 'in-progress',
        checkpoint: { stage: 'player_alias' },
        reconciliation: { sourceRows: 2002, archivedRows: 100 },
      })

      const completed = await importLegacyReferenceHistory(connectionString, {
        legacyWritersQuiesced: true,
        batchSize: 100,
      })
      expect(completed).toEqual({
        status: 'complete',
        checkpoint: null,
        reconciliation: {
          sourceRows: 2002,
          archivedRows: 2002,
          importedAliases: 1001,
          importedHistory: 1001,
          rejectedRows: 0,
          sourceExact: true,
          destinationExact: true,
          exact: true,
        },
      })
      const verify = postgres(connectionString, { max: 1 })
      try {
        const [outbox] = await verify<{ events: number; versions: number }[]>`
          SELECT count(*)::integer AS events, count(DISTINCT source_version)::integer AS versions
          FROM players.discovery_outbox
        `
        expect(outbox).toEqual({ events: 2002, versions: 22 })
      } finally {
        await verify.end()
      }
    },
    120_000,
  )
})
