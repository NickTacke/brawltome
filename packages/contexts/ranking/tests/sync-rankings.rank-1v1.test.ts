import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRank1v1 } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { and, eq, inArray } from 'drizzle-orm'

const TEST_REGION = 'test-rank-1v1'
const TEST_IDS = [991001, 991002, 991003, 991004]

const playerRepo = createPlayerRepo(db)

beforeAll(async () => {
  await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))

  await db.insert(player).values(TEST_IDS.map((id) => ({ brawlhallaId: id, name: `T${id}` })))
})

afterAll(async () => {
  await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))
})

describe('replaceRankPage1v1', () => {
  it('inserts new ranks for an empty page', async () => {
    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [
        { brawlhallaId: 991001, rank: 1 },
        { brawlhallaId: 991002, rank: 2 },
      ],
    })
    const rows = await db.query.playerRank1v1.findMany({
      where: eq(playerRank1v1.region, TEST_REGION),
      orderBy: (t, { asc }) => [asc(t.rank)],
    })
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
    expect(rows.map((r) => r.brawlhallaId)).toEqual([991001, 991002])
  })

  it('replaces page contents - banned player drops, others promote', async () => {
    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [
        { brawlhallaId: 991003, rank: 1 },
        { brawlhallaId: 991001, rank: 2 },
      ],
    })
    const rows = await db.query.playerRank1v1.findMany({
      where: eq(playerRank1v1.region, TEST_REGION),
      orderBy: (t, { asc }) => [asc(t.rank)],
    })
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
    expect(rows.map((r) => r.brawlhallaId)).toEqual([991003, 991001])
    const banned = await db.query.playerRank1v1.findFirst({
      where: and(eq(playerRank1v1.region, TEST_REGION), eq(playerRank1v1.brawlhallaId, 991002)),
    })
    expect(banned).toBeUndefined()
  })

  it('only deletes ranks within the page range', async () => {
    await db.insert(playerRank1v1).values({
      brawlhallaId: 991004,
      region: TEST_REGION,
      rank: 51,
    })

    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 1 }],
    })

    const page2 = await db.query.playerRank1v1.findFirst({
      where: and(eq(playerRank1v1.region, TEST_REGION), eq(playerRank1v1.rank, 51)),
    })
    expect(page2?.brawlhallaId).toBe(991004)
  })

  it('rolls back if INSERT fails (duplicate rank in batch)', async () => {
    await expect(
      playerRepo.replaceRankPage1v1({
        region: TEST_REGION,
        page: 1,
        pageSize: 50,
        entries: [
          { brawlhallaId: 991001, rank: 1 },
          { brawlhallaId: 991002, rank: 1 },
        ],
      }),
    ).rejects.toThrow()

    const rows = await db.query.playerRank1v1.findMany({
      where: and(eq(playerRank1v1.region, TEST_REGION), eq(playerRank1v1.rank, 1)),
    })
    expect(rows.length).toBe(1)
  })
})
