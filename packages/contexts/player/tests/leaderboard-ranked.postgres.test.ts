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
})
