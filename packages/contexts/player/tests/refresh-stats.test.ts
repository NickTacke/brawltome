import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BhV1Guild, BhV1PlayerGuild, BhV1PlayerStatsAll } from '@brawltome/bhapi'
import { db, legend, player, playerClan, playerStatsLegend, playerWeaponStat } from '@brawltome/database'
import { initGameData } from '@brawltome/shared'
import { eq, inArray } from 'drizzle-orm'
import { processRefreshStats } from '../commands/refresh-player'

const TEST_ID = 990050
const GUILD_ID = 8001

// Legend IDs used in the fixture — must exist in the legend table for weapon aggregation to work
const LEGEND_ID_FULL = 3 // bodvar (Hammer + Sword)
const LEGEND_ID_SPARSE = 4 // cassidy (Pistol + Hammer)

const STATS_FIXTURE: BhV1PlayerStatsAll = {
  brawlhalla_id: TEST_ID,
  name: 'TestPlayer',
  games: 200,
  wins: 100,
  xp: 5000,
  level: 10,
  xp_percentage: 0.75,
  damage_bomb: 500,
  damage_mine: 200,
  damage_spikeball: 100,
  damage_sidekick: 50,
  hit_snowball: 3,
  ko_bomb: 2,
  ko_mine: 1,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
  region_ranks: [],
  legends: [
    {
      legend_id: LEGEND_ID_FULL,
      games: 120,
      wins: 60,
      xp: 3000,
      level: 8,
      xp_percentage: 0.5,
      damage_dealt: 50000,
      damage_taken: 40000,
      kos: 80,
      falls: 70,
      suicides: 2,
      team_kos: 5,
      match_time: 12000,
      damage_unarmed: 1000,
      damage_thrown_item: 500,
      damage_weapon_one: 20000,
      damage_weapon_two: 15000,
      damage_gadgets: 300,
      ko_unarmed: 3,
      ko_thrown_item: 7,
      ko_weapon_one: 40,
      ko_weapon_two: 30,
      ko_gadgets: 1,
      time_held_weapon_one: 5000,
      time_held_weapon_two: 4000,
    },
    {
      // Sparse legend — omits xp, level, xp_percentage, ko_thrown_item
      legend_id: LEGEND_ID_SPARSE,
      games: 80,
      wins: 40,
      damage_dealt: 30000,
      damage_taken: 25000,
      kos: 50,
      falls: 45,
      suicides: 1,
      team_kos: 2,
      match_time: 8000,
      damage_unarmed: 500,
      damage_thrown_item: 200,
      damage_weapon_one: 10000,
      damage_weapon_two: 8000,
      damage_gadgets: 100,
      ko_unarmed: 1,
      ko_weapon_one: 20,
      ko_weapon_two: 15,
      ko_gadgets: 0,
      time_held_weapon_one: 3000,
      time_held_weapon_two: 2500,
    },
  ],
}

const GUILD_FIXTURE: BhV1Guild = {
  guild_id: GUILD_ID,
  name: 'TestGuild',
  create_date: 1660419655,
  xp: 10000,
  legacy_xp: 90000,
  notice: '',
  tags: [],
  discord_invite_code: '',
  guild_points: 5000,
  is_recruiting: false,
}

const PLAYER_GUILD_FIXTURE: BhV1PlayerGuild = {
  brawlhalla_id: TEST_ID,
  guild: {
    guild_id: GUILD_ID,
    guild_name: 'TestGuild',
    personal_xp: 1234,
    personal_xp_this_week: 50,
    personal_points: 200,
    join_date: 1660419655,
    rank: 'Member',
  },
}

const stub = {
  getPlayerStatsV1: async (_id: number, _mode: string, _opts?: unknown) => STATS_FIXTURE,
  getPlayerGuildV1: async (_id: number, _opts?: unknown) => PLAYER_GUILD_FIXTURE,
  getGuildStatsV1: async (_id: number, _opts?: unknown) => GUILD_FIXTURE,
  getAllLegendsV1: async (_opts?: unknown) => [
    {
      legend_id: LEGEND_ID_FULL,
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
      legend_id: LEGEND_ID_SPARSE,
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
  ],
}

beforeAll(async () => {
  // Seed test legends so getLegendById + aggregateWeapons work
  await db
    .insert(legend)
    .values([
      {
        legendId: LEGEND_ID_FULL,
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
      {
        legendId: LEGEND_ID_SPARSE,
        legendNameKey: 'cassidy',
        bioName: 'Cassidy',
        bioAka: '',
        bioQuote: '',
        bioQuoteAboutAttrib: '',
        bioQuoteFrom: '',
        bioQuoteFromAttrib: '',
        bioText: '',
        botName: '',
        weaponOne: 'Pistol',
        weaponTwo: 'Hammer',
        strength: '4',
        dexterity: '6',
        defense: '4',
        speed: '6',
      },
    ])
    .onConflictDoNothing()

  await initGameData(db)

  // Clean test player rows
  await db.delete(playerClan).where(eq(playerClan.brawlhallaId, TEST_ID))
  await db.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, TEST_ID))
  await db.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, TEST_ID))
  await db.delete(player).where(eq(player.brawlhallaId, TEST_ID))

  await db.insert(player).values({ brawlhallaId: TEST_ID, name: 'old' })

  await processRefreshStats({ db, bhapi: stub as never }, TEST_ID)
})

afterAll(async () => {
  await db.delete(playerClan).where(eq(playerClan.brawlhallaId, TEST_ID))
  await db.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, TEST_ID))
  await db.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, TEST_ID))
  await db.delete(player).where(eq(player.brawlhallaId, TEST_ID))
  await db.delete(legend).where(inArray(legend.legendId, [LEGEND_ID_FULL, LEGEND_ID_SPARSE]))
})

describe('processRefreshStats - key preservation', () => {
  const PRES_ID = 990051
  const UNRESOLVABLE_LEGEND_ID = 77

  afterAll(async () => {
    await db.delete(playerClan).where(eq(playerClan.brawlhallaId, PRES_ID))
    await db.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, PRES_ID))
    await db.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, PRES_ID))
    await db.delete(player).where(eq(player.brawlhallaId, PRES_ID))
  })

  it('preserves existing legend metadata and progress when sparse fields are omitted', async () => {
    await db
      .insert(player)
      .values({ brawlhallaId: PRES_ID, name: 'presStatsPlayer', xp: 9000, level: 12, xpPercentage: 0.4 })
      .onConflictDoNothing()
    await db.insert(playerStatsLegend).values({
      brawlhallaId: PRES_ID,
      legendId: UNRESOLVABLE_LEGEND_ID,
      legendNameKey: 'preserved_key',
      xp: 4321,
      level: 9,
      xpPercentage: 0.25,
      games: 1,
      wins: 0,
      matchTime: 0,
      kos: 0,
      teamKos: 0,
      suicides: 0,
      falls: 0,
      damageDealt: 0n,
      damageTaken: 0n,
      damageWeaponOne: 0n,
      damageWeaponTwo: 0n,
      timeHeldWeaponOne: 0,
      timeHeldWeaponTwo: 0,
      koWeaponOne: 0,
      koWeaponTwo: 0,
      koUnarmed: 0,
      koThrownItem: 0,
      koGadgets: 0,
      damageUnarmed: 0n,
      damageThrownItem: 0n,
      damageGadgets: 0n,
    })

    const unresolvableStub = {
      getPlayerStatsV1: async () =>
        ({
          ...STATS_FIXTURE,
          brawlhalla_id: PRES_ID,
          xp: undefined,
          level: undefined,
          xp_percentage: undefined,
          legends: [
            {
              legend_id: UNRESOLVABLE_LEGEND_ID,
              games: 5,
              wins: 2,
              damage_dealt: 0,
              damage_taken: 0,
              kos: 0,
              falls: 0,
              suicides: 0,
              team_kos: 0,
              match_time: 0,
              damage_unarmed: 0,
              damage_thrown_item: 0,
              damage_weapon_one: 0,
              damage_weapon_two: 0,
              damage_gadgets: 0,
              ko_unarmed: 0,
              ko_thrown_item: 0,
              ko_weapon_one: 0,
              ko_weapon_two: 0,
              ko_gadgets: 0,
              time_held_weapon_one: 0,
              time_held_weapon_two: 0,
            },
          ],
        }) as BhV1PlayerStatsAll,
      getPlayerGuildV1: async () => null,
      getGuildStatsV1: async () => null,
      getAllLegendsV1: async (_opts?: unknown) => [], // empty -> self-heal finds nothing for 77
    }

    await processRefreshStats({ db, bhapi: unresolvableStub as never }, PRES_ID)

    const rows = await db.query.playerStatsLegend.findMany({
      where: eq(playerStatsLegend.brawlhallaId, PRES_ID),
    })
    const row = rows.find((r) => r.legendId === UNRESOLVABLE_LEGEND_ID)
    expect(row).toBeDefined()
    expect(row?.legendNameKey).toBe('preserved_key')
    expect(row?.xp).toBe(4321)
    expect(row?.level).toBe(9)
    expect(row?.xpPercentage).toBe(0.25)

    const preservedPlayer = await db.query.player.findFirst({ where: eq(player.brawlhallaId, PRES_ID) })
    expect(preservedPlayer?.xp).toBe(9000)
    expect(preservedPlayer?.level).toBe(12)
    expect(preservedPlayer?.xpPercentage).toBe(0.4)
  })
})

describe('processRefreshStats - skip blank key', () => {
  const SKIP_ID = 990052
  const NEW_LEGEND_ID = 88 // not in legend table, not in getAllLegendsV1 stub, no existing player row

  afterAll(async () => {
    await db.delete(playerClan).where(eq(playerClan.brawlhallaId, SKIP_ID))
    await db.delete(playerWeaponStat).where(eq(playerWeaponStat.brawlhallaId, SKIP_ID))
    await db.delete(playerStatsLegend).where(eq(playerStatsLegend.brawlhallaId, SKIP_ID))
    await db.delete(player).where(eq(player.brawlhallaId, SKIP_ID))
  })

  it('skips legend row when no name can be resolved (brand-new unresolvable ID)', async () => {
    await db.insert(player).values({ brawlhallaId: SKIP_ID, name: 'skipStatsPlayer' }).onConflictDoNothing()

    const skipStub = {
      getPlayerStatsV1: async () =>
        ({
          ...STATS_FIXTURE,
          brawlhalla_id: SKIP_ID,
          legends: [
            // resolvable: bodvar (LEGEND_ID_FULL = 3) is in the legend table
            { ...STATS_FIXTURE.legends[0], legend_id: LEGEND_ID_FULL },
            // unresolvable: ID 88, no cache entry, no existing row
            {
              legend_id: NEW_LEGEND_ID,
              games: 3,
              wins: 1,
              xp: 0,
              level: 0,
              xp_percentage: 0,
              damage_dealt: 0,
              damage_taken: 0,
              kos: 0,
              falls: 0,
              suicides: 0,
              team_kos: 0,
              match_time: 0,
              damage_unarmed: 0,
              damage_thrown_item: 0,
              damage_weapon_one: 0,
              damage_weapon_two: 0,
              damage_gadgets: 0,
              ko_unarmed: 0,
              ko_thrown_item: 0,
              ko_weapon_one: 0,
              ko_weapon_two: 0,
              ko_gadgets: 0,
              time_held_weapon_one: 0,
              time_held_weapon_two: 0,
            },
          ],
        }) as BhV1PlayerStatsAll,
      getPlayerGuildV1: async () => null,
      getGuildStatsV1: async () => null,
      getAllLegendsV1: async (_opts?: unknown) => [], // empty -> self-heal finds nothing for 88
    }

    await processRefreshStats({ db, bhapi: skipStub as never }, SKIP_ID)

    const rows = await db.query.playerStatsLegend.findMany({
      where: eq(playerStatsLegend.brawlhallaId, SKIP_ID),
    })
    // resolvable legend must be written with its real key
    const bodvar = rows.find((r) => r.legendId === LEGEND_ID_FULL)
    expect(bodvar).toBeDefined()
    expect(bodvar?.legendNameKey).toBe('bodvar')
    // unresolvable legend must NOT be inserted at all
    const blank = rows.find((r) => r.legendId === NEW_LEGEND_ID)
    expect(blank).toBeUndefined()
  })
})

describe('processRefreshStats (v1)', () => {
  it('updates player name, games, wins, xp, level, damageBomb', async () => {
    const row = await db.query.player.findFirst({ where: eq(player.brawlhallaId, TEST_ID) })
    expect(row?.name).toBe('TestPlayer')
    expect(row?.totalGames).toBe(200)
    expect(row?.totalWins).toBe(100)
    expect(row?.xp).toBe(5000)
    expect(row?.level).toBe(10)
    expect(row?.damageBomb).toBe(500n)
  })

  it('inserts stats legends with mapped v1 fields', async () => {
    const rows = await db.query.playerStatsLegend.findMany({
      where: eq(playerStatsLegend.brawlhallaId, TEST_ID),
    })
    expect(rows).toHaveLength(2)

    const full = rows.find((r) => r.legendId === LEGEND_ID_FULL)
    expect(full).toBeDefined()
    expect(full?.games).toBe(120)
    expect(full?.wins).toBe(60)
    expect(full?.xp).toBe(3000)
    expect(full?.level).toBe(8)
    expect(full?.damageDealt).toBe(50000n)
    expect(full?.koThrownItem).toBe(7)
    expect(full?.legendNameKey).toBe('bodvar')
  })

  it('defaults sparse numeric fields to 0 instead of null/NaN', async () => {
    const rows = await db.query.playerStatsLegend.findMany({
      where: eq(playerStatsLegend.brawlhallaId, TEST_ID),
    })
    const sparse = rows.find((r) => r.legendId === LEGEND_ID_SPARSE)
    expect(sparse).toBeDefined()
    // xp, level, xp_percentage omitted in fixture -> must be 0
    expect(sparse?.xp).toBe(0)
    expect(sparse?.level).toBe(0)
    expect(sparse?.xpPercentage).toBe(0)
    // ko_thrown_item omitted -> 0
    expect(sparse?.koThrownItem).toBe(0)
  })

  it('aggregates weapon stats across legends', async () => {
    const rows = await db.query.playerWeaponStat.findMany({
      where: eq(playerWeaponStat.brawlhallaId, TEST_ID),
    })
    // Hammer: bodvar weapon_one (ko=40) + cassidy weapon_two (ko=15)
    const hammer = rows.find((r) => r.weapon === 'Hammer')
    expect(hammer).toBeDefined()
    expect(hammer?.kos).toBe(40 + 15)
  })

  it('writes clan row with membership personal_xp and computed lifetime_xp', async () => {
    const row = await db.query.playerClan.findFirst({ where: eq(playerClan.brawlhallaId, TEST_ID) })
    expect(row?.clanId).toBe(GUILD_ID)
    expect(row?.clanName).toBe('TestGuild')
    expect(row?.clanXp).toBe(10000n)
    // clan_lifetime_xp = legacy_xp + xp = 90000 + 10000
    expect(row?.clanLifetimeXp).toBe(100000n)
    // personal_xp comes from membership, not guild stats
    expect(row?.personalXp).toBe(1234)
  })
})
