import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createPlayerProcedures } from '../api/procedures'
import { readMetaLegends } from '../api/read-meta-legends'
import { readMetaLegendGames } from '../db/read-meta-legend-games'
import { playerModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const seasonThirtyNine = { season: 39, startsAt: '1970-01-01T00:00:00.000Z' }
const resetDay = '2026-06-24T15:00:00.000Z'
const seasonStartsAt = '2026-06-24T14:00:00.000Z'
const beforeTheStart = '2026-06-24T13:59:59.000Z'
const thisSeason = '2026-07-01T12:00:00.000Z'

type LegendRecord = { nameKey: string; rating: number; wins: number; games: number }

let database: TestDatabase

async function insertSnapshot(brawlhallaId: number, observedAt: string, legends: LegendRecord[]) {
  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, 'Legend Player', ${observedAt}, ${observedAt}, 'EU', 2000, 2000, 'Diamond', 1, 2)
  `

  for (const [ordinal, legend] of legends.entries()) {
    await database.sql`
      INSERT INTO players.ranked_legends
        (brawlhalla_id, ordinal, legend_id, legend_name_key, rating, peak_rating, tier, wins, games)
      VALUES (
        ${brawlhallaId}, ${ordinal}, ${ordinal + 1}, ${legend.nameKey},
        ${legend.rating}, ${legend.rating}, 'Diamond', ${legend.wins}, ${legend.games}
      )
    `
  }
}

// thirty players whose game counts fell on the reset day, which is how a season start is found
async function insertReset() {
  for (let brawlhallaId = 1000; brawlhallaId < 1030; brawlhallaId += 1) {
    await insertSnapshot(brawlhallaId, resetDay, [])

    await database.sql`
      INSERT INTO players.ranked_rating_history (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
      SELECT ${brawlhallaId}, 1500, 1500, 'Gold 1', 1, games, recorded_at::timestamptz
      FROM (VALUES (40, '2026-06-17T15:00:00.000Z'), (2, ${resetDay})) AS points (games, recorded_at)
    `
  }
}

// enough players of one legend to clear the player floor the site uses
async function insertRegulars(firstId: number, nameKey: string, rating: number) {
  for (let brawlhallaId = firstId; brawlhallaId < firstId + 30; brawlhallaId += 1) {
    await insertSnapshot(brawlhallaId, thisSeason, [{ nameKey, rating, wins: 6, games: 10 }])
  }
}

function procedures() {
  return createPlayerProcedures({ database })
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_meta_legends', modules: [queueModule, playerModule] })

  await insertReset()

  await insertSnapshot(301, thisSeason, [
    { nameKey: 'diana', rating: 2100, wins: 15, games: 20 },
    { nameKey: 'mordex', rating: 2000, wins: 4, games: 10 },
  ])

  await insertSnapshot(302, thisSeason, [
    { nameKey: 'diana', rating: 2050, wins: 15, games: 30 },
    // just under the rating floor
    { nameKey: 'mordex', rating: 1999, wins: 90, games: 100 },
    // rated high, but one game short of the floor
    { nameKey: 'sidra', rating: 2200, wins: 9, games: 9 },
  ])

  await insertSnapshot(303, seasonStartsAt, [
    { nameKey: 'teros', rating: 2300, wins: 20, games: 50 },
    { nameKey: 'ada', rating: 2000, wins: 5, games: 10 },
  ])

  // seen just before the reset, so these games belong to last season
  await insertSnapshot(304, beforeTheStart, [{ nameKey: 'diana', rating: 2500, wins: 500, games: 500 }])

  await insertRegulars(2000, 'lucien', 1800)
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('readMetaLegendGames', () => {
  test("ranks this season's legends by the average rating of the players who play them, any rating", async () => {
    const legends = await readMetaLegendGames(database, seasonStartsAt, 1)
    const order = legends.map(({ legendNameKey, averageRating }) => [legendNameKey, averageRating])

    // mordex and ada both average 2000, and mordex's 110 games put it first
    expect(order.slice(0, 4)).toEqual([
      ['teros', 2300],
      ['diana', 2075],
      ['mordex', 2000],
      ['ada', 2000],
    ])
  })

  test('counts every game of the legends a player has ten or more games on', async () => {
    const legends = await readMetaLegendGames(database, seasonStartsAt, 1)

    expect(legends.find(({ legendNameKey }) => legendNameKey === 'mordex')).toEqual({
      legendNameKey: 'mordex',
      games: 110,
      wins: 94,
      playerCount: 2,
      averageRating: 2000,
    })

    expect(legends.map(({ legendNameKey }) => legendNameKey)).not.toContain('sidra')
  })

  test('leaves out legends too few players play', async () => {
    const legends = await readMetaLegendGames(database, seasonStartsAt, 2)

    expect(legends.map(({ legendNameKey }) => legendNameKey)).toEqual(['diana', 'mordex', 'lucien'])
  })
})

describe('player.metaLegends', () => {
  test('only names legends at least thirty players play', async () => {
    const meta = await call(procedures().metaLegends, undefined, internalCaller)

    expect(meta).toEqual({
      season: 40,
      startsAt: seasonStartsAt,
      legends: [{ legendNameKey: 'lucien', games: 300, playerCount: 30, winRate: 0.6, averageRating: 1800 }],
    })
  })

  test('keeps serving the legends it read for a while', async () => {
    const { metaLegends } = procedures()

    await call(metaLegends, undefined, internalCaller)
    await insertRegulars(3000, 'thor', 2400)

    const meta = await call(metaLegends, undefined, internalCaller)

    expect(meta?.legends.map(({ legendNameKey }) => legendNameKey)).not.toContain('thor')
  })

  test('rejects callers from outside', () => {
    expect(call(procedures().metaLegends, undefined, outsideCaller)).rejects.toThrow()
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
