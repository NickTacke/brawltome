import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/queue'
import postgres from 'postgres'
import {
  createPostgresCareerPlayers,
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  playerModule,
} from '../index'

let database: TestDatabase
let connectionString = ''

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'player_canonical_name',
    modules: [refreshOperationsModule, playerModule],
  })

  connectionString = database.connectionString
}, 20_000)

afterAll(async () => {
  await database?.drop()
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
    const source = createPostgresPlayerDiscoverySource(database)
    const ranked = createPostgresRankedPlayers(database)
    const career = createPostgresCareerPlayers(database)

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
      await control.end()
    }
  })
})
