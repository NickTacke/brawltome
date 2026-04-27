import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRank1v1 } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { eq, inArray } from 'drizzle-orm'
import { getLeaderboard } from '../queries/get-leaderboard'
import { createRankingRepo } from '../ranking.repo'

const TEST_REGION = 'test-lb'
const TEST_IDS = Array.from({ length: 30 }, (_, i) => 993000 + i)

const playerRepo = createPlayerRepo(db)
const rankingRepo = createRankingRepo(db)

beforeAll(async () => {
  await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))

  await db.insert(player).values(
    TEST_IDS.map((id, i) => ({
      brawlhallaId: id,
      name: `T${id}`,
      rating: 2500 - i,
      region: TEST_REGION,
    })),
  )

  const fresh = new Date()
  const stale = new Date(Date.now() - 73 * 60 * 60 * 1000)
  await db.insert(playerRank1v1).values(
    TEST_IDS.map((id, i) => ({
      brawlhallaId: id,
      region: TEST_REGION,
      rank: i + 1,
      syncedAt: i < 25 ? fresh : stale,
    })),
  )
})

afterAll(async () => {
  await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))
})

describe('getLeaderboard 1v1 rank-based', () => {
  it('returns first 10 ordered by rank ASC', async () => {
    const result = await getLeaderboard(
      { rankingRepo, playerRepo },
      { bracket: '1v1', region: TEST_REGION, page: 1, pageSize: 10 },
    )
    expect(result.entries.length).toBe(10)
    expect(result.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('filters out entries whose rank is older than 72h', async () => {
    const result = await getLeaderboard(
      { rankingRepo, playerRepo },
      { bracket: '1v1', region: TEST_REGION, page: 1, pageSize: 50 },
    )
    expect(result.entries.length).toBe(25)
  })
})
