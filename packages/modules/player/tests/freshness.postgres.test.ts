import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import postgres from 'postgres'
import { createPostgresPlayerFreshness, playerModule } from '../index'

let database: TestDatabase
let connectionString = ''

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_freshness', modules: [queueModule, playerModule] })
  connectionString = database.connectionString
}, 20_000)

afterAll(async () => {
  await database?.drop()
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
    const freshness = createPostgresPlayerFreshness(database)

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

      await control`
        INSERT INTO players.leaderboard_ranked_observations
          (brawlhalla_id, region, rating, peak_rating, tier, wins, games, observed_at)
        VALUES (1, 'EU', 2000, 2100, 'Diamond', 1, 2, '2026-10-07T12:00:00Z')
      `

      expect(await freshness.lastPlayedById([1, 2])).toEqual(new Map([[1, new Date('2026-10-07T12:00:00Z')]]))
      expect(await freshness.lastPlayedById([])).toEqual(new Map())
    } finally {
      await control.end()
    }
  })
})
