import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRankedTeam } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { eq, inArray } from 'drizzle-orm'

const TEST_REGION = 'test-2v2'
const TEST_IDS = [992001, 992002, 992003, 992004, 992005, 992006]

const playerRepo = createPlayerRepo(db)

const teamArgs = (one: number, two: number, rank: number) => ({
  brawlhallaIdOne: one,
  brawlhallaIdTwo: two,
  teamName: `t${one}+t${two}`,
  rating: 2000,
  peakRating: 2000,
  tier: 'Diamond',
  wins: 50,
  games: 100,
  region: TEST_REGION,
  globalRank: rank,
})

beforeAll(async () => {
  await db.delete(playerRankedTeam).where(eq(playerRankedTeam.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))
  await db.insert(player).values(TEST_IDS.map((id) => ({ brawlhallaId: id, name: `T${id}` })))
})

afterAll(async () => {
  await db.delete(playerRankedTeam).where(eq(playerRankedTeam.region, TEST_REGION))
  await db.delete(player).where(inArray(player.brawlhallaId, TEST_IDS))
})

describe('replaceRankPage2v2', () => {
  it('inserts new team rows for an empty page (2 rows per team)', async () => {
    await playerRepo.replaceRankPage2v2({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      teams: [teamArgs(992001, 992002, 1), teamArgs(992003, 992004, 2)],
    })
    const rows = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.region, TEST_REGION),
      orderBy: (t, { asc }) => [asc(t.globalRank), asc(t.brawlhallaId)],
    })
    expect(rows.length).toBe(4)
    const ids = rows.map((r) => r.brawlhallaId).sort()
    expect(ids).toEqual([992001, 992002, 992003, 992004])
  })

  it('replaces page contents - banned team drops, new team inserted', async () => {
    await playerRepo.replaceRankPage2v2({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      teams: [teamArgs(992005, 992006, 1), teamArgs(992003, 992004, 2)],
    })
    const rows = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.region, TEST_REGION),
    })
    const ids = rows.map((r) => r.brawlhallaId).sort()
    expect(ids).toEqual([992003, 992004, 992005, 992006])
    expect(ids.includes(992001)).toBe(false)
    expect(ids.includes(992002)).toBe(false)
  })
})
