import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BhV1PlayerStatsAll, BhV1PlayerStatsRanked, BhV1PlayerTeams } from '@brawltome/bhapi'
import {
  db,
  legend,
  player,
  playerAlias,
  playerRankedLegend,
  playerRankedTeam,
  ratingHistory,
} from '@brawltome/database'
import { initGameData } from '@brawltome/shared'
import { eq, inArray } from 'drizzle-orm'
import { processRefreshRanked } from '../commands/refresh-player'

const TEST_ID = 990060
const PARTNER_ID = 999001
const LEGEND_ID = 3 // bodvar

const RANKED_FIXTURE: BhV1PlayerStatsRanked = {
  brawlhalla_id: TEST_ID,
  name: 'TestRankedPlayer',
  games: 100,
  wins: 50,
  rating: 1800,
  peak_rating: 1900,
  tier: 'Diamond',
  region: 'US-E',
  region_ranks: [],
  legends: [
    { legend_id: LEGEND_ID, games: 80, wins: 40, rating: 1750, peak_rating: 1850, tier: 'Diamond' },
    { legend_id: 4, games: 20, wins: 10, rating: 1600, peak_rating: 1700, tier: 'Platinum' },
  ],
}

const LIFETIME_FIXTURE: BhV1PlayerStatsAll = {
  brawlhalla_id: TEST_ID,
  name: 'TestRankedPlayer',
  games: 100,
  wins: 50,
  damage_bomb: 0,
  damage_mine: 0,
  damage_spikeball: 0,
  damage_sidekick: 0,
  hit_snowball: 0,
  ko_bomb: 0,
  ko_mine: 0,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
  region_ranks: [],
  legends: [],
}

const TEAMS_FIXTURE: BhV1PlayerTeams = {
  brawlhalla_id: TEST_ID,
  teams: {
    ranked_2v2: [
      {
        brawlhalla_id_one: TEST_ID,
        brawlhalla_id_two: PARTNER_ID,
        username_one: 'A',
        username_two: 'B',
        rating: 1700,
        peak_rating: 1800,
        tier: 'Gold',
        wins: 20,
        games: 30,
        region: 'EU',
        region_ranks: [],
        global_rank: 500,
      },
    ],
  },
}

// v1 legend shape returned by bhapi on a cache miss so initGameData can upsert + resolve
const getAllLegendsV1 = async (_opts?: unknown) => [
  {
    legend_id: LEGEND_ID,
    legend_name: 'bodvar',
    bio_name: 'Bodvar',
    bio_aka: '',
    bio_quote: '',
    bio_quote_about_attrib: '',
    bio_quote_from: '',
    bio_quote_from_attrib: '',
    bio_text: '',
    bot_name: '',
    weapon_one: 'Hammer',
    weapon_two: 'Sword',
    strength: 6,
    dexterity: 6,
    defense: 4,
    speed: 4,
  },
  {
    legend_id: 4,
    legend_name: 'cassidy',
    bio_name: 'Cassidy',
    bio_aka: '',
    bio_quote: '',
    bio_quote_about_attrib: '',
    bio_quote_from: '',
    bio_quote_from_attrib: '',
    bio_text: '',
    bot_name: '',
    weapon_one: 'Pistol',
    weapon_two: 'Hammer',
    strength: 4,
    dexterity: 6,
    defense: 4,
    speed: 6,
  },
]

async function cleanPlayer() {
  await db.delete(ratingHistory).where(eq(ratingHistory.brawlhallaId, TEST_ID))
  await db.delete(playerRankedTeam).where(eq(playerRankedTeam.brawlhallaId, TEST_ID))
  await db.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, TEST_ID))
  await db.delete(playerAlias).where(eq(playerAlias.brawlhallaId, TEST_ID))
  await db.delete(player).where(eq(player.brawlhallaId, TEST_ID))
}

async function seedPlayer(overrides: Partial<{ name: string; rating: number }> = {}) {
  await cleanPlayer()
  await db
    .insert(player)
    .values({ brawlhallaId: TEST_ID, name: overrides.name ?? 'old', rating: overrides.rating ?? 0 })
}

beforeAll(async () => {
  await db
    .insert(legend)
    .values([
      {
        legendId: LEGEND_ID,
        legendNameKey: 'bodvar',
        bioName: 'Bodvar',
        bioAka: '',
        bioQuote: '',
        bioQuoteAboutAttrib: '',
        bioQuoteFrom: '',
        bioQuoteFromAttrib: '',
        bioText: '',
        botName: '',
        weaponOne: 'Hammer',
        weaponTwo: 'Sword',
        strength: '6',
        dexterity: '6',
        defense: '4',
        speed: '4',
      },
    ])
    .onConflictDoNothing()

  await initGameData(db)
})

afterAll(async () => {
  await cleanPlayer()
  // legend 4 may be upserted by initGameData when the cache-miss guard triggers
  await db.delete(legend).where(inArray(legend.legendId, [LEGEND_ID, 4]))
})

describe('processRefreshRanked (v1)', () => {
  it('full refresh: writes 1v1 + legends + team + rating snapshot', async () => {
    await seedPlayer()

    const stub = {
      getPlayerStatsV1: async () => RANKED_FIXTURE,
      getPlayerTeamsV1: async () => TEAMS_FIXTURE,
      getAllLegendsV1,
    }
    await processRefreshRanked({ db, bhapi: stub as never }, TEST_ID)

    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    expect(row?.rating).toBe(1800)
    expect(row?.peakRating).toBe(1900)
    expect(row?.rankedGames).toBe(100)
    expect(row?.rankedWins).toBe(50)
    expect(row?.tier).toBe('Diamond')
    expect(row?.region).toBe('US-E')
    // best legend is LEGEND_ID (80 games > 20 games)
    expect(row?.bestLegend).toBe(LEGEND_ID)
    expect(row?.bestLegendGames).toBe(80)
    expect(row?.bestLegendWins).toBe(40)

    const legends = await db.query.playerRankedLegend.findMany({
      where: eq(playerRankedLegend.brawlhallaId, TEST_ID),
    })
    expect(legends).toHaveLength(2)
    const bodvar = legends.find((l) => l.legendId === LEGEND_ID)
    expect(bodvar).toBeDefined()
    expect(bodvar?.legendNameKey).toBe('bodvar')
    expect(bodvar?.rating).toBe(1750)
    // legend 4 was not in cache at start; cache-miss guard must self-heal and resolve to 'cassidy'
    const cassidy = legends.find((l) => l.legendId === 4)
    expect(cassidy).toBeDefined()
    expect(cassidy?.legendNameKey).toBe('cassidy')

    const teams = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, TEST_ID),
    })
    expect(teams).toHaveLength(1)
    expect(teams[0]?.teamName).toBe('A + B')
    expect(teams[0]?.brawlhallaIdOne).toBe(TEST_ID)
    expect(teams[0]?.brawlhallaIdTwo).toBe(PARTNER_ID)
    expect(teams[0]?.region).toBe('EU')

    const snapshots = await db.query.ratingHistory.findMany({
      where: eq(ratingHistory.brawlhallaId, TEST_ID),
    })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.rating).toBe(1800)
  })

  it('region normalization: JPS -> JPN for 1v1 and team', async () => {
    await seedPlayer()

    const baseTeam = TEAMS_FIXTURE.teams.ranked_2v2[0]
    if (!baseTeam) throw new Error('fixture missing team')

    const jpsRanked: BhV1PlayerStatsRanked = { ...RANKED_FIXTURE, region: 'JPS' }
    const jpsTeams: BhV1PlayerTeams = {
      brawlhalla_id: TEST_ID,
      teams: {
        ranked_2v2: [{ ...baseTeam, region: 'JPS' }],
      },
    }
    const stub = {
      getPlayerStatsV1: async () => jpsRanked,
      getPlayerTeamsV1: async () => jpsTeams,
      getAllLegendsV1,
    }
    await processRefreshRanked({ db, bhapi: stub as never }, TEST_ID)

    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    expect(row?.region).toBe('JPN')

    const teams = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, TEST_ID),
    })
    expect(teams[0]?.region).toBe('JPN')
  })

  it('ranked_1v1 null: clears stale 1v1 (unranked) + stamps timestamp, still writes team', async () => {
    await seedPlayer({ rating: 999 })

    const stub = {
      getPlayerStatsV1: async (_id: number, mode: string) => (mode === 'all' ? LIFETIME_FIXTURE : null),
      getPlayerTeamsV1: async () => TEAMS_FIXTURE,
      getAllLegendsV1,
    }
    await processRefreshRanked({ db, bhapi: stub as never }, TEST_ID)

    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    // no ranked 1v1 this season -> rank cleared, timestamp advanced
    expect(row?.rating).toBe(0)
    expect(row?.tier).toBeNull()
    expect(row?.rankedLastUpdated).not.toBeNull()
    expect(Date.now() - new Date(row?.rankedLastUpdated ?? 0).getTime()).toBeLessThan(60_000)

    const teams = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, TEST_ID),
    })
    expect(teams).toHaveLength(1)
    expect(teams[0]?.teamName).toBe('A + B')
  })

  it('ranked null plus explicit empty teams clears stale ranked data', async () => {
    await seedPlayer({ rating: 999 })
    await db.insert(playerRankedTeam).values({
      brawlhallaId: TEST_ID,
      brawlhallaIdOne: TEST_ID,
      brawlhallaIdTwo: 77777,
      teamName: 'Stale + Team',
      rating: 1500,
      peakRating: 1600,
      tier: 'Silver',
      wins: 5,
      games: 10,
      region: 'EU',
      valhallanConfirmedAt: null,
    })

    const stub = {
      getPlayerStatsV1: async (_id: number, mode: string) => (mode === 'all' ? LIFETIME_FIXTURE : null),
      getPlayerTeamsV1: async () => ({ brawlhalla_id: TEST_ID, teams: { ranked_2v2: [] } }),
      getAllLegendsV1,
    }
    await processRefreshRanked({ db, bhapi: stub as never }, TEST_ID)

    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    expect(row?.rating).toBe(0)
    expect(row?.rankedLastUpdated).not.toBeNull()

    const teams = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, TEST_ID),
    })
    expect(teams).toHaveLength(0)
  })

  it('preserves existing legendNameKey when legend_id is unresolvable after self-heal', async () => {
    const PRES_ID = 990061
    const UNRESOLVABLE_LEGEND_ID = 77

    // Seed player and a ranked legend row with a known good key
    await db.insert(player).values({ brawlhallaId: PRES_ID, name: 'presPlayer' }).onConflictDoNothing()
    await db.insert(playerRankedLegend).values({
      brawlhallaId: PRES_ID,
      legendId: UNRESOLVABLE_LEGEND_ID,
      legendNameKey: 'preserved_key',
      rating: 1,
      peakRating: 1,
      tier: 'Tin 1',
      wins: 0,
      games: 1,
    })

    // API returns legend 77 but getAllLegendsV1 does NOT include it -> self-heal can't resolve
    const unresolvableStub = {
      getPlayerStatsV1: async () =>
        ({
          ...RANKED_FIXTURE,
          brawlhalla_id: PRES_ID,
          legends: [
            { legend_id: UNRESOLVABLE_LEGEND_ID, games: 10, wins: 5, rating: 1000, peak_rating: 1100, tier: 'Tin 1' },
          ],
        }) as BhV1PlayerStatsRanked,
      getPlayerTeamsV1: async () => null,
      getAllLegendsV1: async (_opts?: unknown) => [], // empty -> self-heal finds nothing for 77
    }

    await processRefreshRanked({ db, bhapi: unresolvableStub as never }, PRES_ID)

    const legends = await db.query.playerRankedLegend.findMany({
      where: eq(playerRankedLegend.brawlhallaId, PRES_ID),
    })
    const row = legends.find((l) => l.legendId === UNRESOLVABLE_LEGEND_ID)
    expect(row).toBeDefined()
    expect(row?.legendNameKey).toBe('preserved_key')

    // Cleanup
    await db.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, PRES_ID))
    await db.delete(ratingHistory).where(eq(ratingHistory.brawlhallaId, PRES_ID))
    await db.delete(playerAlias).where(eq(playerAlias.brawlhallaId, PRES_ID))
    await db.delete(player).where(eq(player.brawlhallaId, PRES_ID))
  })

  it('skips legend row when no name can be resolved (brand-new unresolvable ID)', async () => {
    const SKIP_ID = 990062
    const NEW_LEGEND_ID = 88 // not in legend table, not in getAllLegendsV1 stub, no existing player row

    await db.insert(player).values({ brawlhallaId: SKIP_ID, name: 'skipPlayer' }).onConflictDoNothing()

    const skipStub = {
      getPlayerStatsV1: async () =>
        ({
          ...RANKED_FIXTURE,
          brawlhalla_id: SKIP_ID,
          legends: [
            // resolvable: bodvar (LEGEND_ID = 3) is in the legend table
            { legend_id: LEGEND_ID, games: 10, wins: 5, rating: 1500, peak_rating: 1600, tier: 'Gold' },
            // unresolvable: ID 88, no cache entry, no existing row
            { legend_id: NEW_LEGEND_ID, games: 3, wins: 1, rating: 1000, peak_rating: 1100, tier: 'Tin 1' },
          ],
        }) as BhV1PlayerStatsRanked,
      getPlayerTeamsV1: async () => null,
      getAllLegendsV1: async (_opts?: unknown) => [], // empty -> self-heal finds nothing for 88
    }

    await processRefreshRanked({ db, bhapi: skipStub as never }, SKIP_ID)

    const legends = await db.query.playerRankedLegend.findMany({
      where: eq(playerRankedLegend.brawlhallaId, SKIP_ID),
    })
    // resolvable legend must be written with its real key
    const bodvar = legends.find((l) => l.legendId === LEGEND_ID)
    expect(bodvar).toBeDefined()
    expect(bodvar?.legendNameKey).toBe('bodvar')
    // unresolvable legend must NOT be inserted at all
    const blank = legends.find((l) => l.legendId === NEW_LEGEND_ID)
    expect(blank).toBeUndefined()

    // Cleanup
    await db.delete(playerRankedLegend).where(eq(playerRankedLegend.brawlhallaId, SKIP_ID))
    await db.delete(ratingHistory).where(eq(ratingHistory.brawlhallaId, SKIP_ID))
    await db.delete(playerAlias).where(eq(playerAlias.brawlhallaId, SKIP_ID))
    await db.delete(player).where(eq(player.brawlhallaId, SKIP_ID))
  })

  it('teams null preserves the last-known team while still updating 1v1', async () => {
    await seedPlayer()

    // Pre-seed a team row that must survive an ambiguous 404.
    await db.insert(playerRankedTeam).values({
      brawlhallaId: TEST_ID,
      brawlhallaIdOne: TEST_ID,
      brawlhallaIdTwo: 88888,
      teamName: 'Pre + Seeded',
      rating: 1500,
      peakRating: 1600,
      tier: 'Silver',
      wins: 5,
      games: 10,
      region: 'EU',
      valhallanConfirmedAt: null,
    })

    const stub = {
      getPlayerStatsV1: async () => RANKED_FIXTURE,
      getPlayerTeamsV1: async () => null,
      getAllLegendsV1,
    }
    await processRefreshRanked({ db, bhapi: stub as never }, TEST_ID)

    // 1v1 updated
    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    expect(row?.rating).toBe(1800)

    const teams = await db.query.playerRankedTeam.findMany({
      where: eq(playerRankedTeam.brawlhallaId, TEST_ID),
    })
    expect(teams).toHaveLength(1)
    expect(teams[0]?.teamName).toBe('Pre + Seeded')
  })
})
