import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRankedTeam } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player'
import { eq, inArray } from 'drizzle-orm'
import { saveTeams } from '../commands/sync-rankings'

const TEST_REGION = 'TEST-2V2'
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

  it('saveTeams produces non-duplicate rows even with multiple ranking entries', async () => {
    await db.delete(playerRankedTeam).where(eq(playerRankedTeam.region, TEST_REGION))

    const rankings = [
      {
        rank: 1,
        teamname: 'X',
        brawlhalla_id_one: 992001,
        brawlhalla_id_two: 992002,
        rating: 2000,
        peak_rating: 2000,
        tier: 'Diamond',
        wins: 50,
        games: 100,
        region: TEST_REGION,
      },
      {
        rank: 2,
        teamname: 'Y',
        brawlhalla_id_one: 992003,
        brawlhalla_id_two: 992004,
        rating: 1900,
        peak_rating: 1900,
        tier: 'Diamond',
        wins: 40,
        games: 90,
        region: TEST_REGION,
      },
    ]

    await saveTeams(playerRepo, rankings as never, TEST_REGION, 1, undefined)

    const rows = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.region, TEST_REGION),
    })
    expect(rows.length).toBe(4)
  })

  it('handles a self-team (idOne === idTwo) without conflict-key duplicate', async () => {
    await db.delete(playerRankedTeam).where(eq(playerRankedTeam.region, TEST_REGION))

    await playerRepo.replaceRankPage2v2({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      teams: [teamArgs(992001, 992001, 1), teamArgs(992003, 992004, 2)],
    })

    const rows = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.region, TEST_REGION),
      orderBy: (t, { asc }) => [asc(t.globalRank)],
    })
    expect(rows.length).toBe(3)
    const selfTeam = rows.filter((r) => r.brawlhallaIdOne === r.brawlhallaIdTwo)
    expect(selfTeam.length).toBe(1)
    expect(selfTeam[0]?.brawlhallaId).toBe(992001)
  })

  it('returns empty vacatedSourcePages when no batch team exists outside the page range', async () => {
    const result = await playerRepo.replaceRankPage2v2({
      region: TEST_REGION,
      page: 1,
      pageSize: 50,
      teams: [
        {
          brawlhallaIdOne: TEST_IDS[0],
          brawlhallaIdTwo: TEST_IDS[1],
          teamName: 'A+B',
          rating: 2000,
          peakRating: 2000,
          tier: 'Gold',
          wins: 10,
          games: 20,
          globalRank: 1,
        },
      ],
    })
    expect(result.vacatedSourcePages).toEqual([])
  })

  it('returns distinct source pages for cross-page mover teams', async () => {
    await db.delete(playerRankedTeam).where(eq(playerRankedTeam.region, TEST_REGION))
    await db.insert(playerRankedTeam).values([
      {
        brawlhallaId: TEST_IDS[0],
        brawlhallaIdOne: TEST_IDS[0],
        brawlhallaIdTwo: TEST_IDS[1],
        teamName: 'A+B',
        rating: 1500,
        peakRating: 1500,
        tier: 'Gold',
        wins: 1,
        games: 2,
        region: TEST_REGION,
        globalRank: 60,
      },
      {
        brawlhallaId: TEST_IDS[1],
        brawlhallaIdOne: TEST_IDS[0],
        brawlhallaIdTwo: TEST_IDS[1],
        teamName: 'A+B',
        rating: 1500,
        peakRating: 1500,
        tier: 'Gold',
        wins: 1,
        games: 2,
        region: TEST_REGION,
        globalRank: 60,
      },
      {
        brawlhallaId: TEST_IDS[2],
        brawlhallaIdOne: TEST_IDS[2],
        brawlhallaIdTwo: TEST_IDS[3],
        teamName: 'C+D',
        rating: 1300,
        peakRating: 1300,
        tier: 'Silver',
        wins: 1,
        games: 2,
        region: TEST_REGION,
        globalRank: 105,
      },
      {
        brawlhallaId: TEST_IDS[3],
        brawlhallaIdOne: TEST_IDS[2],
        brawlhallaIdTwo: TEST_IDS[3],
        teamName: 'C+D',
        rating: 1300,
        peakRating: 1300,
        tier: 'Silver',
        wins: 1,
        games: 2,
        region: TEST_REGION,
        globalRank: 105,
      },
    ])

    const result = await playerRepo.replaceRankPage2v2({
      region: TEST_REGION,
      page: 4,
      pageSize: 50,
      teams: [
        {
          brawlhallaIdOne: TEST_IDS[0],
          brawlhallaIdTwo: TEST_IDS[1],
          teamName: 'A+B',
          rating: 1700,
          peakRating: 1700,
          tier: 'Plat',
          wins: 1,
          games: 2,
          globalRank: 151,
        },
        {
          brawlhallaIdOne: TEST_IDS[2],
          brawlhallaIdTwo: TEST_IDS[3],
          teamName: 'C+D',
          rating: 1700,
          peakRating: 1700,
          tier: 'Plat',
          wins: 1,
          games: 2,
          globalRank: 152,
        },
      ],
    })

    expect(result.vacatedSourcePages.sort()).toEqual([2, 3])
  })
})
