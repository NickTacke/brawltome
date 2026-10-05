import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import {
  createPostgresCareerPlayers,
  createPostgresLeaderboardPlayerNames,
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  playerMigrationInventory,
} from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_names_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
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

describe('Player names observed on leaderboards', () => {
  test('propagates renamed known players and makes unseen players searchable idempotently', async () => {
    const control = postgres(connectionString, { max: 1 })
    const source = createPostgresPlayerDiscoverySource(connectionString)
    const names = createPostgresLeaderboardPlayerNames(connectionString)
    const outboxCount = async () =>
      Number((await control<{ count: string }[]>`SELECT count(*) AS count FROM players.discovery_outbox`)[0].count)
    const factsById = async () => new Map((await source.snapshot()).facts.map((fact) => [fact.brawlhallaId, fact]))
    try {
      await insertCareer(control, 100, 'Old Name', '2024-01-01T00:00:00Z', 'legacy-v2')
      await insertRanked(control, 101, 'Same Name', '2026-09-01T00:00:00Z')
      await insertCareer(control, 103, 'Müller', '2026-09-01T00:00:00Z')
      await insertCareer(control, 105, 'Fresh Career', '2026-10-05T12:00:00Z')

      const before = await outboxCount()
      const firstScan = new Date('2026-10-05T00:00:00Z')
      await names.applyLeaderboardNames({
        observedAt: firstScan,
        players: [
          { brawlhallaId: 100, name: 'New Name' },
          { brawlhallaId: 100, name: 'New Name' },
          { brawlhallaId: 101, name: 'Same Name' },
          { brawlhallaId: 102, name: 'Unknown Climber' },
          { brawlhallaId: 103, name: 'MÃ¼ller' },
          { brawlhallaId: 104, name: 'Name unavailable #104' },
          { brawlhallaId: 105, name: 'Stale Board' },
          { brawlhallaId: 106, name: 'Player 106' },
        ],
      })
      expect(await outboxCount()).toBeGreaterThan(before)

      let facts = await factsById()
      expect(facts.get(100)).toMatchObject({ name: 'New Name', aliases: ['Old Name'] })
      expect(facts.get(101)).toMatchObject({ name: 'Same Name', aliases: [] })
      expect(facts.get(102)).toMatchObject({ name: 'Unknown Climber', aliases: [], rating: null })
      expect(facts.get(103)).toMatchObject({ name: 'Müller', aliases: [] })
      expect(facts.has(104)).toBe(false)
      expect(facts.get(105)).toMatchObject({ name: 'Fresh Career' })
      expect(facts.has(106)).toBe(false)
      const recordedAliases = await control<{ brawlhalla_id: number; display_alias: string }[]>`
        SELECT brawlhalla_id, display_alias FROM players.discovery_aliases ORDER BY brawlhalla_id, display_alias
      `
      expect([...recordedAliases]).toEqual([{ brawlhalla_id: 100, display_alias: 'Old Name' }])
      expect(await names.referenceById(100)).toEqual({ brawlhallaId: 100, name: 'New Name', observedAt: firstScan })

      const settled = await outboxCount()
      await names.applyLeaderboardNames({
        observedAt: new Date('2026-10-05T00:15:00Z'),
        players: [
          { brawlhallaId: 100, name: 'New Name' },
          { brawlhallaId: 102, name: 'Unknown Climber' },
          { brawlhallaId: 103, name: 'MÃ¼ller' },
        ],
      })
      await names.applyLeaderboardNames({
        observedAt: new Date('2026-09-01T00:00:00Z'),
        players: [{ brawlhallaId: 100, name: 'Ancient Name' }],
      })
      expect(await outboxCount()).toBe(settled)
      expect((await factsById()).get(100)).toMatchObject({ name: 'New Name' })

      await names.applyLeaderboardNames({
        observedAt: new Date('2026-10-05T00:30:00Z'),
        players: [{ brawlhallaId: 100, name: 'Newest Name' }],
      })
      facts = await factsById()
      expect(facts.get(100)?.name).toBe('Newest Name')
      expect(facts.get(100)?.aliases).toEqual(expect.arrayContaining(['New Name', 'Old Name']))
      expect(await names.referenceById(100)).toMatchObject({ name: 'Newest Name' })
      expect(await names.referenceById(104)).toBeNull()
    } finally {
      await Promise.all([control.end(), source.close(), names.close()])
    }
  })
})
