import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import {
  createPostgresLeaderboardPlayerNames,
  createPostgresLeaderboardRanked,
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  playerMigrationInventory,
} from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_lb_ranked_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Player PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of playerMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function insertRanked(sql: ReturnType<typeof postgres>, brawlhallaId: number, refreshedAt: string) {
  await sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
       global_rank, region_rank)
    VALUES (${brawlhallaId}, 'V0 Name', ${refreshedAt}, ${refreshedAt}, 'EU', 2000, 2100, 'Diamond', 10, 20, 50, 5)
  `
}

const standing = (brawlhallaId: number, rating: number) => ({
  brawlhallaId,
  region: 'AUS',
  rating,
  peakRating: 2200,
  tier: 'Diamond',
  wins: 39,
  games: 69,
})

describe('Ranked standings observed on leaderboards', () => {
  test('records changed standings only and republishes them to discovery', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const outboxFor = async (brawlhallaId: number) =>
      Number(
        (
          await control<{ count: string }[]>`
            SELECT count(*) AS count FROM players.discovery_outbox WHERE brawlhalla_id = ${brawlhallaId}
          `
        )[0].count,
      )
    try {
      const first = new Date('2026-10-07T12:00:00Z')
      expect(
        await standings.applyLeaderboardRanked({
          observedAt: first,
          players: [standing(200, 1973), standing(200, 1500), { ...standing(0, 1), brawlhallaId: 0 }],
        }),
      ).toEqual({ changed: 1 })
      expect(await outboxFor(200)).toBe(1)

      // V1 serves cached rows: an unchanged standing keeps its first observation time and writes nothing.
      const unchanged = new Date('2026-10-07T12:15:00Z')
      expect(await standings.applyLeaderboardRanked({ observedAt: unchanged, players: [standing(200, 1973)] })).toEqual(
        { changed: 0 },
      )
      expect(await outboxFor(200)).toBe(1)

      const moved = new Date('2026-10-07T12:30:00Z')
      expect(await standings.applyLeaderboardRanked({ observedAt: moved, players: [standing(200, 1990)] })).toEqual({
        changed: 1,
      })
      // An older publication never overwrites a newer observation.
      expect(await standings.applyLeaderboardRanked({ observedAt: unchanged, players: [standing(200, 1800)] })).toEqual(
        { changed: 0 },
      )
      const [row] = await control<{ rating: number; observed_at: Date }[]>`
        SELECT rating, observed_at FROM players.leaderboard_ranked_observations WHERE brawlhalla_id = 200
      `
      expect(row).toEqual({ rating: 1990, observed_at: moved })
      expect(await standings.standingById(200)).toEqual({
        brawlhallaId: 200,
        region: 'AUS',
        rating: 1990,
        peakRating: 2200,
        tier: 'Diamond',
        wins: 39,
        games: 69,
        observedAt: moved,
      })
      expect(await standings.standingById(999)).toBeNull()
      expect(await outboxFor(200)).toBe(2)
    } finally {
      await Promise.all([control.end(), standings.close()])
    }
  })

  test('shows the newer of the V0 refresh and the leaderboard on profiles and in search', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const names = createPostgresLeaderboardPlayerNames(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    const source = createPostgresPlayerDiscoverySource(connectionString)
    try {
      await insertRanked(control, 300, '2026-10-07T10:00:00Z')
      await insertRanked(control, 301, '2026-10-07T13:00:00Z')
      const observedAt = new Date('2026-10-07T12:00:00Z')
      await names.applyLeaderboardNames({
        observedAt,
        players: [
          { brawlhallaId: 300, name: 'V0 Name' },
          { brawlhallaId: 301, name: 'V0 Name' },
          { brawlhallaId: 302, name: 'Never Visited' },
        ],
      })
      await standings.applyLeaderboardRanked({
        observedAt,
        players: [standing(300, 1973), standing(301, 1973), standing(302, 1973)],
      })

      const stale = await ranked.byId(300)
      expect(stale?.lastSuccessAt).toEqual(new Date('2026-10-07T10:00:00Z'))
      expect(stale?.snapshot?.oneVsOne).toMatchObject({
        region: 'AUS',
        rating: 1973,
        peakRating: 2200,
        tier: 'Diamond',
        wins: 39,
        games: 69,
        // Ranks are not on the leaderboard row, so they stay with the V0 snapshot.
        globalRank: 50,
        regionRank: 5,
      })
      const refreshedLater = await ranked.byId(301)
      expect(refreshedLater?.snapshot?.oneVsOne).toMatchObject({ region: 'EU', rating: 2000, wins: 10, games: 20 })
      expect(await ranked.byId(302)).toBeNull()

      const facts = new Map((await source.snapshot()).facts.map((fact) => [fact.brawlhallaId, fact]))
      expect(facts.get(300)).toMatchObject({ rating: 1973, region: 'AUS' })
      expect(facts.get(301)).toMatchObject({ rating: 2000, region: 'EU' })
      expect(facts.get(302)).toMatchObject({ name: 'Never Visited', rating: 1973, region: 'AUS' })
    } finally {
      await Promise.all([control.end(), standings.close(), names.close(), ranked.close(), source.close()])
    }
  })

  test('overlays newer solo queue and fixed team standings and records them changed-only', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    try {
      await insertRanked(control, 400, '2026-10-07T10:00:00Z')
      await control`
        INSERT INTO players.ranked_solo_queue
          (brawlhalla_id, ordinal, team_name, rating, peak_rating, tier, wins, games, region, global_rank)
        VALUES (400, 0, 'Solo Queue', 1500, 1600, 'Gold 3', 5, 10, 'EU', 900)
      `
      await control`
        INSERT INTO players.ranked_fixed_teams
          (brawlhalla_id, ordinal, brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating, tier, wins,
           games, region, global_rank)
        VALUES (400, 0, 401, 400, 'Duo', 1700, 1750, 'Platinum 2', 7, 12, 'EU', 300),
               (400, 1, 400, 402, 'Other Duo', 1400, 1450, 'Gold 1', 2, 4, 'EU', NULL)
      `
      const observedAt = new Date('2026-10-07T12:00:00Z')
      expect(
        await standings.applyLeaderboardSoloQueue({
          observedAt,
          players: [{ ...standing(400, 1620), region: 'EU', peakRating: 1640, tier: 'Gold 5', wins: 9, games: 16 }],
        }),
      ).toEqual({ changed: 1 })
      expect(
        await standings.applyLeaderboardTeams({
          observedAt,
          teams: [
            // Pairs are stored lower id first, whichever order the leaderboard lists them in.
            {
              brawlhallaIdOne: 401,
              brawlhallaIdTwo: 400,
              region: 'EU',
              rating: 1810,
              peakRating: 1820,
              tier: 'Platinum 4',
              wins: 11,
              games: 18,
            },
            {
              brawlhallaIdOne: 400,
              brawlhallaIdTwo: 401,
              region: 'EU',
              rating: 1,
              peakRating: 1,
              tier: null,
              wins: 0,
              games: 0,
            },
          ],
        }),
      ).toEqual({ changed: 1 })
      // Unchanged values write nothing.
      expect(
        await standings.applyLeaderboardTeams({
          observedAt: new Date('2026-10-07T12:15:00Z'),
          teams: [
            {
              brawlhallaIdOne: 400,
              brawlhallaIdTwo: 401,
              region: 'EU',
              rating: 1810,
              peakRating: 1820,
              tier: 'Platinum 4',
              wins: 11,
              games: 18,
            },
          ],
        }),
      ).toEqual({ changed: 0 })

      const profile = await ranked.byId(400)
      expect(profile?.snapshot?.soloQueue).toEqual([
        {
          secondPlayerId: 0,
          teamName: 'Solo Queue',
          region: 'EU',
          globalRank: 900,
          rating: 1620,
          peakRating: 1640,
          tier: 'Gold 5',
          wins: 9,
          games: 16,
        },
      ])
      expect(profile?.snapshot?.fixedTeams).toEqual([
        expect.objectContaining({ teamName: 'Duo', globalRank: 300, rating: 1810, wins: 11, games: 18 }),
        expect.objectContaining({ teamName: 'Other Duo', rating: 1400, wins: 2, games: 4 }),
      ])

      // A V0 refresh newer than the observation wins.
      await control`UPDATE players.ranked_profiles SET last_success_at = '2026-10-07T13:00:00Z' WHERE brawlhalla_id = 400`
      const refreshed = await ranked.byId(400)
      expect(refreshed?.snapshot?.soloQueue[0]?.rating).toBe(1500)
      expect(refreshed?.snapshot?.fixedTeams[0]?.rating).toBe(1700)
    } finally {
      await Promise.all([control.end(), standings.close(), ranked.close()])
    }
  })

  test('shows whichever of the V0 refresh, a team pulse, and a team observation is newest', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    const team = (rating: number, wins: number, games: number) => ({
      brawlhallaIdOne: 500,
      brawlhallaIdTwo: 501,
      region: 'EU',
      rating,
      peakRating: 1900,
      tier: 'Platinum 4',
      wins,
      games,
    })
    const pulseAt = async (observedAt: string) => {
      await control`
        INSERT INTO players.ranked_v1_fixed_team_pulses
          (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two, rating, peak_rating, wins, games, effect_created_at,
           effect_operation_id, observed_at)
        VALUES (500, 500, 501, 1850, 1900, 15, 25, ${observedAt}, ${randomUUID()}::uuid, ${observedAt})
        ON CONFLICT (brawlhalla_id, brawlhalla_id_one, brawlhalla_id_two) DO UPDATE SET
          effect_created_at = EXCLUDED.effect_created_at, observed_at = EXCLUDED.observed_at
      `
    }
    try {
      await insertRanked(control, 500, '2026-10-07T10:00:00Z')
      await control`
        UPDATE players.ranked_profiles SET v0_effect_created_at = '2026-10-07T10:00:00Z' WHERE brawlhalla_id = 500
      `
      await control`
        INSERT INTO players.ranked_fixed_teams
          (brawlhalla_id, ordinal, brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating, tier, wins,
           games, region, global_rank)
        VALUES (500, 0, 500, 501, 'Duo', 1700, 1750, 'Platinum 2', 7, 12, 'EU', 300)
      `

      // V0 10:00, crawl 11:00, pulse 12:00: the pulse is newest.
      await standings.applyLeaderboardTeams({
        observedAt: new Date('2026-10-07T11:00:00Z'),
        teams: [team(1800, 11, 18)],
      })
      await pulseAt('2026-10-07T12:00:00Z')
      expect((await ranked.byId(500))?.snapshot?.fixedTeams[0]).toEqual(
        expect.objectContaining({ rating: 1850, wins: 15, games: 25 }),
      )

      // V0 10:00, pulse 11:00, crawl 12:00: the crawl is newest.
      await pulseAt('2026-10-07T11:00:00Z')
      await standings.applyLeaderboardTeams({
        observedAt: new Date('2026-10-07T12:00:00Z'),
        teams: [team(1820, 13, 21)],
      })
      expect((await ranked.byId(500))?.snapshot?.fixedTeams[0]).toEqual(
        expect.objectContaining({ rating: 1820, wins: 13, games: 21 }),
      )
    } finally {
      await Promise.all([control.end(), standings.close(), ranked.close()])
    }
  })
})

describe('Solo queue and fixed teams only the deep crawl has seen', () => {
  const team = (brawlhallaIdOne: number, brawlhallaIdTwo: number, rating: number, tier: string | null = 'Gold 2') => ({
    brawlhallaIdOne,
    brawlhallaIdTwo,
    region: 'EU',
    rating,
    peakRating: rating + 10,
    tier,
    wins: 4,
    games: 7,
  })

  test('appends newer crawl-only entries after the V0 ones, named the way V0 names teams', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    try {
      await insertRanked(control, 600, '2026-10-07T10:00:00Z')
      await control`
        INSERT INTO players.ranked_fixed_teams
          (brawlhalla_id, ordinal, brawlhalla_id_one, brawlhalla_id_two, team_name, rating, peak_rating, tier, wins,
           games, region, global_rank)
        VALUES (600, 0, 601, 600, 'Old Partner+V0 Name', 1700, 1750, 'Platinum 2', 7, 12, 'EU', 300)
      `
      // The live V0 name beats a newer leaderboard name, as in the player reference.
      await control`
        INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at)
        VALUES (599, 'Lower Partner', '2026-10-07T09:00:00Z'),
               (600, 'Cached Name', '2026-10-07T11:00:00Z'),
               (602, 'Crawl Partner', '2026-10-07T09:00:00Z'),
               (605, 'Tierless Partner', '2026-10-07T09:00:00Z'),
               (606, 'Former Partner', '2026-10-07T09:00:00Z')
      `
      await standings.applyLeaderboardTeams({
        observedAt: new Date('2026-10-07T09:30:00Z'),
        teams: [team(600, 606, 1950)],
      })
      await standings.applyLeaderboardTeams({
        observedAt: new Date('2026-10-07T12:00:00Z'),
        teams: [
          team(600, 601, 1810),
          team(602, 600, 1600),
          team(600, 599, 1900),
          team(600, 604, 2000),
          team(600, 605, 1650, null),
        ],
      })
      await standings.applyLeaderboardSoloQueue({
        observedAt: new Date('2026-10-07T12:00:00Z'),
        players: [{ ...standing(600, 1620), region: 'EU', peakRating: 1640, tier: 'Gold 5', wins: 9, games: 16 }],
      })

      const snapshot = (await ranked.byId(600))?.snapshot
      expect(snapshot?.fixedTeams).toEqual([
        // The V0 team keeps its name and rank and takes the newer numbers.
        expect.objectContaining({
          brawlhallaIdOne: 601,
          teamName: 'Old Partner+V0 Name',
          globalRank: 300,
          rating: 1810,
        }),
        // Unknown partner (604), no tier (605), and a team last seen before the V0 refresh (606) are left out.
        {
          brawlhallaIdOne: 599,
          brawlhallaIdTwo: 600,
          teamName: 'Lower Partner+V0 Name',
          region: 'EU',
          globalRank: null,
          rating: 1900,
          peakRating: 1910,
          tier: 'Gold 2',
          wins: 4,
          games: 7,
        },
        expect.objectContaining({ brawlhallaIdOne: 600, brawlhallaIdTwo: 602, teamName: 'V0 Name+Crawl Partner' }),
      ])
      expect(snapshot?.soloQueue).toEqual([
        {
          secondPlayerId: 0,
          teamName: 'V0 Name',
          region: 'EU',
          globalRank: null,
          rating: 1620,
          peakRating: 1640,
          tier: 'Gold 5',
          wins: 9,
          games: 16,
        },
      ])

      // A V0 refresh newer than the crawl drops the entries it did not list.
      await control`UPDATE players.ranked_profiles SET last_success_at = '2026-10-07T13:00:00Z' WHERE brawlhalla_id = 600`
      const refreshed = (await ranked.byId(600))?.snapshot
      expect(refreshed?.fixedTeams).toEqual([
        expect.objectContaining({ teamName: 'Old Partner+V0 Name', rating: 1700, globalRank: 300 }),
      ])
      expect(refreshed?.soloQueue).toEqual([])
    } finally {
      await Promise.all([control.end(), standings.close(), ranked.close()])
    }
  })

  test('adds no crawl-only solo queue entry beside the V0 ones', async () => {
    const control = postgres(connectionString, { max: 1 })
    const standings = createPostgresLeaderboardRanked(connectionString)
    const ranked = createPostgresRankedPlayers(connectionString)
    try {
      await insertRanked(control, 610, '2026-10-07T10:00:00Z')
      await control`
        INSERT INTO players.ranked_solo_queue
          (brawlhalla_id, ordinal, team_name, rating, peak_rating, tier, wins, games, region, global_rank)
        VALUES (610, 0, 'Solo Queue', 1500, 1600, 'Gold 3', 5, 10, 'SEA', 900)
      `
      await standings.applyLeaderboardSoloQueue({
        observedAt: new Date('2026-10-07T12:00:00Z'),
        players: [{ ...standing(610, 1620), region: 'EU', tier: 'Gold 5' }],
      })

      expect((await ranked.byId(610))?.snapshot?.soloQueue).toEqual([
        expect.objectContaining({ teamName: 'Solo Queue', region: 'SEA', globalRank: 900, rating: 1620 }),
      ])
    } finally {
      await Promise.all([control.end(), standings.close(), ranked.close()])
    }
  })
})
