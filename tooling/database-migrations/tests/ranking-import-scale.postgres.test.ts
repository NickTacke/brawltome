import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  importLegacyRankings,
  rankingMigrationInventory,
  readLegacyRankingMigrationEvidence,
} from '@brawltome/ranking/composition'
import postgres from 'postgres'
import { legacyClanRankingSchemaSql } from './fixtures/legacy-clans-rankings'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const databaseName = `bt_ranking_scale_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
    throw new Error(`Ranking scale tests require the dedicated server ${dedicatedServer}`)
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
    await setup.unsafe(legacyClanRankingSchemaSql)
    for (const migration of rankingMigrationInventory) await setup.unsafe(migration.sql)
    await setup`
      INSERT INTO public.player
        (brawlhalla_id, name, region, rating, peak_rating, tier, ranked_games, ranked_wins, synced_at_1v1)
      SELECT identity,
             'Scale Player ' || identity,
             CASE WHEN identity <= 170001 THEN 'EU' ELSE NULL END,
             CASE WHEN identity <= 170001 THEN identity ELSE 0 END,
             CASE WHEN identity <= 170001 THEN identity ELSE 0 END,
             CASE WHEN identity <= 170001 THEN 'Scale' ELSE NULL END,
             CASE WHEN identity <= 170001 THEN identity ELSE 0 END,
             CASE WHEN identity <= 170001 THEN identity ELSE 0 END,
             CASE WHEN identity <= 170001 THEN '2026-08-01 10:00:00'::timestamp ELSE NULL END
      FROM generate_series(1, 250001) AS identity
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

describe('Ranking V2 import scale', () => {
  scaleTest(
    'imports above the former archive bound and reads bounded evidence for a production-sized scope',
    async () => {
      const result = await importLegacyRankings(connectionString)
      expect(result.status).toBe('complete')
      expect(result.reconciliation).toMatchObject({
        sourceRows: 250001,
        archivedRows: 250001,
        semanticExact: true,
        exact: true,
      })
      expect(result.reconciliation.publishedRows).toBe(170001)

      const evidence = await readLegacyRankingMigrationEvidence(connectionString)
      const eu = evidence.sets.find(({ mode, scope }) => mode === '1v1' && scope === 'EU')
      expect(evidence.status).toBe('complete')
      expect(eu).toMatchObject({ status: 'accepted', rowCount: 170001 })
      expect(eu?.entries).toHaveLength(100)
    },
    600_000,
  )
})
