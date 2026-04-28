import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRank1v1 } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'

const TEST_REGION = 'TEST-RANK-1V1'
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

  it('handles a player moving between pages without PK conflict', async () => {
    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 5 }],
    })

    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 2,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 60 }],
    })

    const rows = await db.query.playerRank1v1.findMany({
      where: and(eq(playerRank1v1.region, TEST_REGION), eq(playerRank1v1.brawlhallaId, 991001)),
    })
    expect(rows.length).toBe(1)
    expect(rows[0]?.rank).toBe(60)
  })

  it('does not drop rows when a cross-page player is in the new batch', async () => {
    // Page 1 has 991001 at rank 1.
    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 1 }],
    })

    // Page 2 sync now sees 991001 (moved from rank 1 to rank 60) AND a fresh entry 991002 at rank 61.
    // Old behaviour collapsed 991001's INSERT via ON CONFLICT UPDATE, leaving the page with 1 row instead of 2.
    await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 2,
      pageSize: 50,
      entries: [
        { brawlhallaId: 991001, rank: 60 },
        { brawlhallaId: 991002, rank: 61 },
      ],
    })

    const page2Rows = await db.query.playerRank1v1.findMany({
      where: and(eq(playerRank1v1.region, TEST_REGION), gte(playerRank1v1.rank, 51), lte(playerRank1v1.rank, 100)),
    })
    expect(page2Rows.length).toBe(2)
    // Source-page slot (rank 1) is intentionally vacated — it'll repopulate on next page-1 sync.
    const oldSlot = await db.query.playerRank1v1.findFirst({
      where: and(eq(playerRank1v1.region, TEST_REGION), eq(playerRank1v1.rank, 1)),
    })
    expect(oldSlot).toBeUndefined()
  })

  it('normalizes regional region casing to uppercase on write', async () => {
    const lowerRegion = TEST_REGION.toLowerCase()
    await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))

    await playerRepo.replaceRankPage1v1({
      region: lowerRegion,
      page: 1,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 1 }],
    })

    const upper = await db.query.playerRank1v1.findMany({ where: eq(playerRank1v1.region, TEST_REGION) })
    const lower = await db.query.playerRank1v1.findMany({ where: eq(playerRank1v1.region, lowerRegion) })
    expect(upper.length).toBe(1)
    expect(lower.length).toBe(0)
  })

  it('returns empty vacatedSourcePages when no batch ID exists outside the page range', async () => {
    await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))

    const result = await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      entries: [
        { brawlhallaId: 991001, rank: 1 },
        { brawlhallaId: 991002, rank: 2 },
      ],
    })

    expect(result.vacatedSourcePages).toEqual([])
  })

  it('returns distinct source pages when batch IDs span multiple foreign pages', async () => {
    await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))

    // Seed: 991001 at rank 5 (page 1), 991002 at rank 60 (page 2), 991003 at rank 105 (page 3)
    await db.insert(playerRank1v1).values([
      { brawlhallaId: 991001, region: TEST_REGION, rank: 5 },
      { brawlhallaId: 991002, region: TEST_REGION, rank: 60 },
      { brawlhallaId: 991003, region: TEST_REGION, rank: 105 },
    ])

    // Sync page 4 (ranks 151-200) with all three IDs at new ranks within the page
    const result = await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 4,
      pageSize: 50,
      entries: [
        { brawlhallaId: 991001, rank: 151 },
        { brawlhallaId: 991002, rank: 152 },
        { brawlhallaId: 991003, rank: 153 },
      ],
    })

    expect(result.vacatedSourcePages.sort()).toEqual([1, 2, 3])
  })

  it('does not list the current page as a vacated source page', async () => {
    await db.delete(playerRank1v1).where(eq(playerRank1v1.region, TEST_REGION))

    // 991001 currently at rank 60 (page 2). New batch keeps them on page 2.
    await db.insert(playerRank1v1).values([{ brawlhallaId: 991001, region: TEST_REGION, rank: 60 }])

    const result = await playerRepo.replaceRankPage1v1({
      region: TEST_REGION,
      page: 2,
      pageSize: 50,
      entries: [{ brawlhallaId: 991001, rank: 75 }],
    })

    expect(result.vacatedSourcePages).toEqual([])
  })
})
