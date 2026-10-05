import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import {
  createPostgresCareerPlayers,
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  playerMigrationInventory,
} from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_canonical_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Player PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of playerMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function insertCareer(
  sql: ReturnType<typeof postgres>,
  brawlhallaId: number,
  name: string,
  observedAt: string,
  source: 'v0-player-snapshot' | 'legacy-v2' = 'v0-player-snapshot',
) {
  await sql`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage,
       games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
       snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES
      (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, ${source}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
       0, 0, 0, 0, 0, 0)
  `
}

async function insertRanked(sql: ReturnType<typeof postgres>, brawlhallaId: number, name: string, observedAt: string) {
  await sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, 'EU', 2000, 2100, 'Diamond', 1, 2)
  `
}

describe('canonical Player names', () => {
  test('canonical discovery names follow the most recent profile observation', async () => {
    const control = postgres(connectionString, { max: 1 })
    const source = createPostgresPlayerDiscoverySource(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    const career = createPostgresCareerPlayers(connectionString)
    try {
      await insertCareer(control, 201, 'Imported Legacy', '2024-01-01T00:00:00Z', 'legacy-v2')
      await insertRanked(control, 201, 'Fresh Ranked', '2026-10-05T12:00:00Z')
      await insertCareer(control, 202, 'Fresh Career', '2026-10-05T12:00:00Z')
      await insertRanked(control, 202, 'Older Ranked', '2026-10-01T00:00:00Z')

      const facts = new Map((await source.snapshot()).facts.map((fact) => [fact.brawlhallaId, fact]))
      expect(facts.get(201)).toMatchObject({ name: 'Fresh Ranked', aliases: ['Imported Legacy'] })
      expect(facts.get(202)).toMatchObject({ name: 'Fresh Career', aliases: ['Older Ranked'] })

      expect(await ranked.referenceById(201)).toMatchObject({
        name: 'Fresh Ranked',
        observedAt: new Date('2026-10-05T12:00:00Z'),
      })
      expect(await career.referenceById(201)).toMatchObject({
        name: 'Imported Legacy',
        observedAt: new Date('2024-01-01T00:00:00Z'),
      })
    } finally {
      await Promise.all([control.end(), source.close(), ranked.close(), career.close()])
    }
  })
})
