import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type TestDatabase, createTestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { createPostgresRankedPlayers, playerModule } from '../index'

let database: TestDatabase
let connectionString = ''

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'player_ranked_history',
    modules: [refreshOperationsModule, playerModule],
  })

  connectionString = database.connectionString
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('ranked rating history', () => {
  test('returns imported V2 history after newer V0 points with the right source labels', async () => {
    const control = postgres(connectionString, { max: 1 })
    const ranked = createPostgresRankedPlayers(database)

    try {
      await control`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (42, 'Fresh V0', '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z', 'US-E', 1900, 1950, 'Diamond', 60, 110)
      `

      await control`
        INSERT INTO players.ranked_rating_history
          (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at, history_source, legacy_source_key,
           source_order)
        VALUES
          (42, 1700, 1750, NULL, 40, 80, '2026-07-01T00:00:00Z', 'v2-legacy', 'player:42:3', 3),
          (42, 1600, 1650, NULL, 30, 60, '2026-06-01T00:00:00Z', 'v2-legacy', 'player:42:2', 2),
          (42, 1500, 1550, NULL, 20, 40, '2026-05-01T00:00:00Z', 'v2-legacy', 'player:42:1', 1)
      `

      await control`
        INSERT INTO players.ranked_rating_history
          (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
        VALUES (42, 1900, 1950, 'Diamond', 60, 110, '2026-08-03T00:00:00Z')
      `

      const profile = await ranked.byId(42)

      expect(profile?.snapshot?.oneVsOne.rating).toBe(1900)

      expect(profile?.snapshot?.ratingHistory.map(({ rating, source }) => ({ rating, source }))).toEqual([
        { rating: 1900, source: 'v0-player-snapshot' },
        { rating: 1700, source: 'legacy-v2' },
        { rating: 1600, source: 'legacy-v2' },
        { rating: 1500, source: 'legacy-v2' },
      ])
    } finally {
      await control.end()
    }
  })
})
