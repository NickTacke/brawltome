import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createPlayerProcedures } from '../api/procedures'
import { readMetaLegends } from '../api/read-meta-legends'
import { playerModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const seasonThirtyNine = { season: 39, startsAt: '1970-01-01T00:00:00.000Z' }
const resetDay = '2026-06-24T15:00:00.000Z'
const seasonStartsAt = '2026-06-24T14:00:00.000Z'
const beforeTheStart = '2026-06-24T13:59:59.000Z'
const thisSeason = '2026-07-01T12:00:00.000Z'

type LegendRecord = { nameKey: string; wins: number; games: number }

let database: TestDatabase

async function insertSnapshot(brawlhallaId: number, observedAt: string, rating: number, legends: LegendRecord[]) {
  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, 'Legend Player', ${observedAt}, ${observedAt}, 'EU', ${rating}, ${rating}, 'Diamond', 1, 2)
  `

  for (const [ordinal, legend] of legends.entries()) {
    await database.sql`
      INSERT INTO players.ranked_legends
        (brawlhalla_id, ordinal, legend_id, legend_name_key, rating, peak_rating, tier, wins, games)
      VALUES (
        ${brawlhallaId}, ${ordinal}, ${ordinal + 1}, ${legend.nameKey},
        ${rating}, ${rating}, 'Diamond', ${legend.wins}, ${legend.games}
      )
    `
  }
}

// thirty players whose game counts fell on the reset day, which is how a season start is found
async function insertReset() {
  for (let brawlhallaId = 1000; brawlhallaId < 1030; brawlhallaId += 1) {
    await insertSnapshot(brawlhallaId, resetDay, 1500, [])

    await database.sql`
      INSERT INTO players.ranked_rating_history (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
      SELECT ${brawlhallaId}, 1500, 1500, 'Gold 1', 1, games, recorded_at::timestamptz
      FROM (VALUES (40, '2026-06-17T15:00:00.000Z'), (2, ${resetDay})) AS points (games, recorded_at)
    `
  }
}

// high rated players who all play one legend, to fill the ladder up to the players floor
async function insertRegulars(firstId: number, playerCount: number) {
  for (let brawlhallaId = firstId; brawlhallaId < firstId + playerCount; brawlhallaId += 1) {
    await insertSnapshot(brawlhallaId, thisSeason, 2400, [{ nameKey: 'lucien', wins: 1, games: 2 }])
  }
}

function procedures() {
  return createPlayerProcedures({ database })
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_meta_legends', modules: [queueModule, playerModule] })

  await insertReset()

  await insertSnapshot(301, thisSeason, 2300, [
    { nameKey: 'diana', wins: 15, games: 20 },
    { nameKey: 'mordex', wins: 4, games: 10 },
  ])

  // rated exactly the floor, which counts
  await insertSnapshot(302, thisSeason, 2200, [
    { nameKey: 'diana', wins: 15, games: 30 },
    // not played this season
    { nameKey: 'sidra', wins: 0, games: 0 },
  ])

  await insertSnapshot(303, seasonStartsAt, 2250, [
    { nameKey: 'teros', wins: 20, games: 50 },
    { nameKey: 'ada', wins: 5, games: 10 },
  ])

  // just under the rating floor
  await insertSnapshot(304, thisSeason, 2199, [{ nameKey: 'mordex', wins: 90, games: 100 }])

  // seen just before the reset, so these games belong to last season
  await insertSnapshot(305, beforeTheStart, 2500, [{ nameKey: 'diana', wins: 500, games: 500 }])

  // with the three above, one player short of the hundred the ranking waits for
  await insertRegulars(2000, 96)
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('player.metaLegends', () => {
  test('names no legends while fewer than a hundred players rated 2200+ have been seen this season', async () => {
    const meta = await call(procedures().metaLegends, undefined, internalCaller)

    expect(meta).toEqual({ season: 40, startsAt: seasonStartsAt, legends: [] })
  })

  test('rejects callers from outside', () => {
    expect(call(procedures().metaLegends, undefined, outsideCaller)).rejects.toThrow()
  })
})

describe('player.metaLegends with a hundred players rated 2200+', () => {
  beforeAll(async () => {
    await insertRegulars(2096, 1)
  })

  test('ranks legends by their share of the games those players have this season, then by name', async () => {
    const meta = await call(procedures().metaLegends, undefined, internalCaller)

    expect(meta).toEqual({
      season: 40,
      startsAt: seasonStartsAt,
      legends: [
        { legendNameKey: 'lucien', games: 194, playerCount: 97, winRate: 0.5, gameShare: 194 / 314 },
        // won 30 of the 50 games, not the 62.5% an average of each player's rate would give
        { legendNameKey: 'diana', games: 50, playerCount: 2, winRate: 0.6, gameShare: 50 / 314 },
        { legendNameKey: 'teros', games: 50, playerCount: 1, winRate: 0.4, gameShare: 50 / 314 },
        { legendNameKey: 'ada', games: 10, playerCount: 1, winRate: 0.5, gameShare: 10 / 314 },
        { legendNameKey: 'mordex', games: 10, playerCount: 1, winRate: 0.4, gameShare: 10 / 314 },
      ],
    })
  })

  test('the shares add up to one', async () => {
    const meta = await call(procedures().metaLegends, undefined, internalCaller)
    const shareSum = meta?.legends.reduce((sum, legend) => sum + legend.gameShare, 0)

    expect(shareSum).toBeCloseTo(1, 10)
  })

  test('keeps serving the legends it read for a while', async () => {
    const { metaLegends } = procedures()

    await call(metaLegends, undefined, internalCaller)
    await insertSnapshot(306, thisSeason, 2400, [{ nameKey: 'thor', wins: 900, games: 900 }])

    const meta = await call(metaLegends, undefined, internalCaller)

    expect(meta?.legends.map(({ legendNameKey }) => legendNameKey)).not.toContain('thor')
  })
})

describe('readMetaLegends', () => {
  test('a season nobody has been seen in yet has no legends', async () => {
    const laterSeason = { season: 41, startsAt: '2026-12-01T14:00:00.000Z' }

    expect(await readMetaLegends(database, [seasonThirtyNine, laterSeason])).toEqual({ ...laterSeason, legends: [] })
  })

  test('is null before any season start has been seen, since any stored game could be from an old season', async () => {
    expect(await readMetaLegends(database, [seasonThirtyNine])).toBeNull()
  })
})
