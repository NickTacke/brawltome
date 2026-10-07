import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createPostgresPlayerFreshness, playerMigrationInventory } from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_freshness_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
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

async function insertRanked(sql: ReturnType<typeof postgres>, brawlhallaId: number, at: string) {
  await sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, 'Name', ${at}, ${at}, 'EU', 2000, 2100, 'Diamond', 1, 2)
  `
}

async function insertCareer(
  sql: ReturnType<typeof postgres>,
  brawlhallaId: number,
  at: string,
  source: 'v0-player-snapshot' | 'legacy-v2' = 'v0-player-snapshot',
) {
  await sql`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage,
       games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
       snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES (${brawlhallaId}, 'Name', ${at}, ${at}, ${source}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `
}

describe('Player freshness', () => {
  test('reports the older full V0 refresh and null when a section never came from V0', async () => {
    const control = postgres(connectionString, { max: 1 })
    const freshness = createPostgresPlayerFreshness(connectionString)
    try {
      await insertRanked(control, 1, '2026-10-07T10:00:00Z')
      await insertCareer(control, 1, '2026-10-07T08:00:00Z')
      await insertRanked(control, 2, '2026-10-07T10:00:00Z')
      await insertCareer(control, 2, '2026-10-07T10:00:00Z', 'legacy-v2')
      await insertRanked(control, 3, '2026-10-07T10:00:00Z')

      expect(await freshness.lastRefreshedById([1, 2, 3, 4, 1])).toEqual(
        new Map([
          [1, new Date('2026-10-07T08:00:00Z')],
          [2, null],
          [3, null],
          [4, null],
        ]),
      )
      expect(await freshness.lastRefreshedById([])).toEqual(new Map())
    } finally {
      await Promise.all([control.end(), freshness.close()])
    }
  })
})
