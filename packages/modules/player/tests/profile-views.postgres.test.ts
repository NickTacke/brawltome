import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type TestDatabase, createTestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import postgres from 'postgres'
import { createPostgresProfileViews, playerModule } from '../index'

let database: TestDatabase
let connectionString = ''

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'player_profile_views',
    modules: [refreshOperationsModule, playerModule],
  })
  connectionString = database.connectionString
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('Profile view demand', () => {
  test('counts views per player and day, reports distinct days in the window, and trims old days', async () => {
    const control = postgres(connectionString, { max: 1 })
    const views = createPostgresProfileViews(database)
    try {
      await control`
        INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
        VALUES (1, 'Known One', clock_timestamp()), (2, 'Known Two', clock_timestamp())
      `
      await views.recordView(1)
      await views.recordView(1)
      await views.recordView(2)
      await views.recordView(0)
      await control`
        INSERT INTO players.profile_view_days (day, brawlhalla_id, views)
        VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date - 3, 1, 4),
               ((clock_timestamp() AT TIME ZONE 'UTC')::date - 20, 3, 1),
               ((clock_timestamp() AT TIME ZONE 'UTC')::date - 40, 4, 1)
      `
      const [today] = await control<{ views: number }[]>`
        SELECT views FROM players.profile_view_days
        WHERE brawlhalla_id = 1 AND day = (clock_timestamp() AT TIME ZONE 'UTC')::date
      `
      expect(today.views).toBe(2)

      const demand = await views.viewDemand({ days: 14 })
      expect(
        demand
          .map(({ brawlhallaId, viewDays }) => ({ brawlhallaId, viewDays }))
          .sort((left, right) => left.brawlhallaId - right.brawlhallaId),
      ).toEqual([
        { brawlhallaId: 1, viewDays: 2 },
        { brawlhallaId: 2, viewDays: 1 },
      ])

      expect(await views.trim({ keepDays: 30 })).toBe(1)
      expect(
        (await control<{ brawlhalla_id: number }[]>`SELECT brawlhalla_id FROM players.profile_view_days`).map(
          ({ brawlhalla_id }) => brawlhalla_id,
        ),
      ).not.toContain(4)
    } finally {
      await control.end()
    }
  })

  test('counts views only for players the Players context already knows', async () => {
    const control = postgres(connectionString, { max: 1 })
    const views = createPostgresProfileViews(database)
    const checksum = 'a'.repeat(64)
    try {
      await control`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (101, 'Ranked', clock_timestamp(), clock_timestamp(), 'EU', 1500, 1600, 'Gold 1', 10, 20)
      `
      // A ranked row from a failed first check carries no identity yet.
      await control`INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at) VALUES (102, clock_timestamp())`
      await control`
        INSERT INTO players.legacy_discovery_profiles
          (brawlhalla_id, player_name, view_count, observed_at, archive_checksum)
        VALUES (103, 'Legacy', 0, clock_timestamp(), ${checksum})
      `
      await control`
        INSERT INTO players.legacy_profile_discovery (brawlhalla_id, player_name, observed_at, archive_checksum)
        VALUES (104, 'Archived', clock_timestamp(), ${checksum})
      `
      await control`
        INSERT INTO players.career_profiles (brawlhalla_id, checked_at) VALUES (106, clock_timestamp())
      `
      for (const brawlhallaId of [101, 102, 103, 104, 105, 106]) await views.recordView(brawlhallaId)

      const recorded = await control<{ brawlhalla_id: number }[]>`
        SELECT brawlhalla_id FROM players.profile_view_days WHERE brawlhalla_id > 100 ORDER BY brawlhalla_id
      `
      expect(recorded.map(({ brawlhalla_id }) => brawlhalla_id)).toEqual([101, 103, 104])
    } finally {
      await control.end()
    }
  })
})
