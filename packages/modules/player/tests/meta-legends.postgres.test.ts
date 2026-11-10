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
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('player.metaLegends', () => {
  test("ranks this season's legends of players rated 2000+ by games, then by name", async () => {
    const meta = await call(procedures().metaLegends, undefined, internalCaller)

    expect(meta).toEqual({
      season: 40,
      startsAt: seasonStartsAt,
      legends: [
        // won 30 of the 50 games, not the 62.5% an average of each player's rate would give
        { legendNameKey: 'diana', games: 50, playerCount: 2, winRate: 0.6 },
        { legendNameKey: 'teros', games: 50, playerCount: 1, winRate: 0.4 },
        { legendNameKey: 'ada', games: 10, playerCount: 1, winRate: 0.5 },
        { legendNameKey: 'mordex', games: 10, playerCount: 1, winRate: 0.4 },
      ],
    })
  })

  test('keeps serving the legends it read for a while', async () => {
    const { metaLegends } = procedures()

    await call(metaLegends, undefined, internalCaller)
    await insertSnapshot(305, thisSeason, [{ nameKey: 'thor', rating: 2400, wins: 900, games: 900 }])

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
