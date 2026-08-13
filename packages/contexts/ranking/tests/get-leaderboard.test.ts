import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { db, player, playerRankedTeam } from '@brawltome/database'
import { createPlayerRepo } from '@brawltome/player/v2-compatibility'
import { inArray, sql } from 'drizzle-orm'

const repo = createPlayerRepo(db)
const TEST_IDS = [9_910_001, 9_910_002, 9_910_003, 9_910_004, 9_910_005]
const TEAM_IDS = [9_911_001, 9_911_002, 9_911_003, 9_911_004]
const ALL_IDS = [...TEST_IDS, ...TEAM_IDS]

beforeAll(async () => {
  await db.delete(playerRankedTeam).where(inArray(playerRankedTeam.brawlhallaId, ALL_IDS))
  await db.delete(player).where(inArray(player.brawlhallaId, ALL_IDS))

  // 1v1 fixtures
  await repo.sweepUpsert1v1([
    {
      brawlhallaId: 9_910_001,
      name: 'Top',
      region: 'EU',
      rating: 2400,
      peakRating: 2400,
      tier: 'Valhallan',
      wins: 100,
      losses: 30,
    },
    {
      brawlhallaId: 9_910_002,
      name: 'Mid',
      region: 'EU',
      rating: 2200,
      peakRating: 2300,
      tier: 'Diamond',
      wins: 80,
      losses: 40,
    },
    {
      brawlhallaId: 9_910_003,
      name: 'Low',
      region: 'US-E',
      rating: 1500,
      peakRating: 1500,
      tier: 'Gold',
      wins: 30,
      losses: 30,
    },
    {
      brawlhallaId: 9_910_004,
      name: 'Stale',
      region: 'EU',
      rating: 2000,
      peakRating: 2000,
      tier: 'Diamond',
      wins: 50,
      losses: 20,
    },
    // Same rating as 9_910_002, fewer wins, must rank below.
    {
      brawlhallaId: 9_910_005,
      name: 'Tied',
      region: 'EU',
      rating: 2200,
      peakRating: 2300,
      tier: 'Diamond',
      wins: 70,
      losses: 40,
    },
  ])
  // Make 9_910_004 stale.
  await db
    .update(player)
    .set({ syncedAt1v1: new Date(Date.now() - 60 * 60 * 1000) })
    .where(sql`${player.brawlhallaId} = 9910004`)

  // 3v3 fixtures (subset of TEST_IDS)
  await repo.sweepUpsert3v3([
    {
      brawlhallaId: 9_910_001,
      name: 'Top',
      region: 'EU',
      rating: 2100,
      peakRating: 2100,
      tier: 'Diamond',
      wins: 60,
      losses: 30,
    },
    {
      brawlhallaId: 9_910_002,
      name: 'Mid',
      region: 'EU',
      rating: 1900,
      peakRating: 1900,
      tier: 'Platinum',
      wins: 50,
      losses: 25,
    },
    {
      brawlhallaId: 9_910_003,
      name: 'Low',
      region: 'US-E',
      rating: 2200,
      peakRating: 2200,
      tier: 'Diamond',
      wins: 70,
      losses: 30,
    },
  ])
  // Make 9_910_003's 3v3 row stale so the 3v3 freshness test actually exercises the filter.
  await db
    .update(player)
    .set({ syncedAt3v3: new Date(Date.now() - 60 * 60 * 1000) })
    .where(sql`${player.brawlhallaId} = 9910003`)

  // 2v2 team fixtures
  await repo.sweepUpsert2v2([
    {
      brawlhallaIdOne: 9_911_001,
      brawlhallaIdTwo: 9_911_002,
      playerOneName: 'TeamA-One',
      playerTwoName: 'TeamA-Two',
      teamName: 'A',
      rating: 2000,
      peakRating: 2000,
      tier: 'Diamond',
      wins: 30,
      losses: 10,
      region: 'EU',
    },
    {
      brawlhallaIdOne: 9_911_003,
      brawlhallaIdTwo: 9_911_004,
      playerOneName: 'TeamB-One',
      playerTwoName: 'TeamB-Two',
      teamName: 'B',
      rating: 1800,
      peakRating: 1900,
      tier: 'Platinum',
      wins: 25,
      losses: 15,
      region: 'US-E',
    },
  ])

  // Solo 2v2 fixture
  await repo.sweepUpsertSolo2v2([
    {
      brawlhallaId: 9_911_001,
      name: 'Top',
      teamName: '',
      rating: 1700,
      peakRating: 1700,
      tier: 'Platinum',
      wins: 20,
      losses: 10,
      region: 'EU',
    },
  ])
})

afterAll(async () => {
  await db.delete(playerRankedTeam).where(inArray(playerRankedTeam.brawlhallaId, ALL_IDS))
  await db.delete(player).where(inArray(player.brawlhallaId, ALL_IDS))
})

const FRESH_30M = () => new Date(Date.now() - 30 * 60 * 1000)

describe('get1v1LeaderboardSweep', () => {
  it('orders by rating desc, tie-break by ranked_wins desc', async () => {
    const rows = await repo.get1v1LeaderboardSweep({ region: 'all', pageSize: 10, offset: 0, freshSince: FRESH_30M() })
    const ids = rows.filter((r) => TEST_IDS.includes(r.brawlhallaId)).map((r) => r.brawlhallaId)
    // Top, then (Mid before Tied because Mid has more wins at same rating), then Low. Stale excluded.
    expect(ids).toEqual([9_910_001, 9_910_002, 9_910_005, 9_910_003])
  })

  it('filters by region', async () => {
    const rows = await repo.get1v1LeaderboardSweep({ region: 'EU', pageSize: 10, offset: 0, freshSince: FRESH_30M() })
    const ids = rows.filter((r) => TEST_IDS.includes(r.brawlhallaId)).map((r) => r.brawlhallaId)
    expect(ids).toEqual([9_910_001, 9_910_002, 9_910_005])
  })
})

describe('get3v3LeaderboardSweep', () => {
  it('orders by rating_3v3 desc with wins_3v3 tie-break, freshness on synced_at_3v3', async () => {
    const rows = await repo.get3v3LeaderboardSweep({ region: 'all', pageSize: 10, offset: 0, freshSince: FRESH_30M() })
    const ids = rows.filter((r) => TEST_IDS.includes(r.brawlhallaId)).map((r) => r.brawlhallaId)
    expect(ids).toEqual([9_910_001, 9_910_002])
  })
})

describe('get2v2LeaderboardSweep', () => {
  it('returns one row per team (deduped) with computed rank', async () => {
    const rows = await repo.get2v2LeaderboardSweep({ region: 'all', pageSize: 10, offset: 0, freshSince: FRESH_30M() })
    const teamIds = rows
      .filter((r) => TEAM_IDS.includes(r.brawlhalla_id_one))
      .map((r) => r.brawlhalla_id_one)
      .sort()
    // Both teams' "first owner" id should appear once each.
    expect(teamIds).toEqual([9_911_001, 9_911_003])
  })
})

describe('getSolo2v2LeaderboardSweep', () => {
  it('only returns rows where brawlhalla_id_two = 0', async () => {
    const rows = await repo.getSolo2v2LeaderboardSweep({
      region: 'all',
      pageSize: 10,
      offset: 0,
      freshSince: FRESH_30M(),
    })
    expect(rows.some((r) => r.brawlhallaId === 9_911_001 && r.brawlhallaIdTwo === 0)).toBe(true)
    // None of the team-only rows should leak through.
    expect(rows.every((r) => r.brawlhallaIdTwo === 0)).toBe(true)
  })
})
