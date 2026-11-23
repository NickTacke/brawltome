import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { createPostgresRankedCoverage, playerModule } from '../index'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'ranked_coverage_reads', modules: [queueModule, playerModule] })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

async function observe(brawlhallaId: number, rating: number, observedAt: string): Promise<void> {
  await database.sql`
    INSERT INTO players.leaderboard_ranked_observations
      (brawlhalla_id, region, rating, peak_rating, tier, wins, games, observed_at)
    VALUES (${brawlhallaId}, 'EU', ${rating}, ${rating}, 'Diamond', 1, 2, ${observedAt})
  `
}

async function insertRankedProfile(brawlhallaId: number, lastSuccessAt: string | null): Promise<void> {
  if (lastSuccessAt === null) {
    await database.sql`
      INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at) VALUES (${brawlhallaId}, clock_timestamp())
    `

    return
  }

  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, 'Name', ${lastSuccessAt}, ${lastSuccessAt}, 'EU', 2000, 2100, 'Diamond', 1, 2)
  `
}

describe('ranked coverage reads', () => {
  test('lists players at or above the rating who played ranked since the cutoff, with their last V0 success', async () => {
    await observe(1, 2300, '2026-11-22T12:00:00Z')
    await observe(2, 1800, '2026-11-22T12:00:00Z')
    await observe(3, 1799, '2026-11-22T12:00:00Z')
    await observe(4, 2100, '2026-11-10T12:00:00Z')
    await observe(5, 2000, '2026-11-22T12:00:00Z')
    await insertRankedProfile(1, '2026-11-21T08:00:00Z')
    // checked but never refreshed: no last success yet
    await insertRankedProfile(5, null)

    const coverage = createPostgresRankedCoverage(database)

    const candidates = await coverage.candidates({
      minimumRating: 1800,
      playedRankedSince: new Date('2026-11-16T12:00:00Z'),
    })

    expect(candidates.sort((left, right) => left.brawlhallaId - right.brawlhallaId)).toEqual([
      { brawlhallaId: 1, rating: 2300, lastSuccessAt: new Date('2026-11-21T08:00:00Z') },
      { brawlhallaId: 2, rating: 1800, lastSuccessAt: null },
      { brawlhallaId: 5, rating: 2000, lastSuccessAt: null },
    ])

    expect(await coverage.lastRankedSuccess(1)).toEqual(new Date('2026-11-21T08:00:00Z'))
    expect(await coverage.lastRankedSuccess(5)).toBeNull()
    expect(await coverage.lastRankedSuccess(2)).toBeNull()
  })
})
