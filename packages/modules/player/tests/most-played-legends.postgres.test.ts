import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createPlayerProcedures } from '../api/procedures'
import { readMostPlayedLegends } from '../api/read-most-played-legends'
import { playerModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const seasonThirtyNine = { season: 39, startsAt: '1970-01-01T00:00:00.000Z' }
const resetDay = '2026-06-24T15:00:00.000Z'
const seasonStartsAt = '2026-06-24T14:00:00.000Z'
const beforeTheStart = '2026-06-24T13:59:59.000Z'
const thisSeason = '2026-07-01T12:00:00.000Z'

type LegendGames = { nameKey: string; games: number }

let database: TestDatabase

async function insertSnapshot(brawlhallaId: number, observedAt: string, legends: LegendGames[]) {
  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, 'Legend Player', ${observedAt}, ${observedAt}, 'EU', 1500, 1500, 'Gold 1', 1, 2)
  `

  for (const [ordinal, legend] of legends.entries()) {
    await database.sql`
      INSERT INTO players.ranked_legends
        (brawlhalla_id, ordinal, legend_id, legend_name_key, rating, peak_rating, tier, wins, games)
      VALUES (${brawlhallaId}, ${ordinal}, ${ordinal + 1}, ${legend.nameKey}, 1500, 1500, 'Gold 1', 0, ${legend.games})
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
  database = await createTestDatabase({ label: 'player_most_played', modules: [queueModule, playerModule] })

  await insertReset()

  await insertSnapshot(201, thisSeason, [
    { nameKey: 'mordex', games: 30 },
    { nameKey: 'diana', games: 10 },
  ])

  await insertSnapshot(202, seasonStartsAt, [
    { nameKey: 'mordex', games: 10 },
    { nameKey: 'new legend', games: 10 },
    { nameKey: 'ada', games: 0 },
  ])

  // seen just before the reset, so these games belong to last season
  await insertSnapshot(203, beforeTheStart, [{ nameKey: 'ada', games: 500 }])
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('player.mostPlayedLegends', () => {
  test("counts only legends seen since the current season's start", async () => {
    const counts = await call(procedures().mostPlayedLegends, undefined, internalCaller)

    expect(counts).toEqual({
      season: 40,
      startsAt: seasonStartsAt,
      playerCount: 2,
      legends: [
        { legendNameKey: 'mordex', games: 40, share: 40 / 60 },
        { legendNameKey: 'diana', games: 10, share: 10 / 60 },
        { legendNameKey: 'new legend', games: 10, share: 10 / 60 },
      ],
    })
  })

  test('keeps serving the counts it read for a while', async () => {
    const { mostPlayedLegends } = procedures()

    await call(mostPlayedLegends, undefined, internalCaller)
    await insertSnapshot(204, thisSeason, [{ nameKey: 'thor', games: 900 }])

    const counts = await call(mostPlayedLegends, undefined, internalCaller)

    expect(counts?.legends.map(({ legendNameKey }) => legendNameKey)).not.toContain('thor')
  })

  test('rejects callers from outside', () => {
    expect(call(procedures().mostPlayedLegends, undefined, outsideCaller)).rejects.toThrow()
  })
})

describe('readMostPlayedLegends', () => {
  test('a season nobody has been seen in yet has no legends', async () => {
    const laterSeason = { season: 41, startsAt: '2026-12-01T14:00:00.000Z' }

    expect(await readMostPlayedLegends(database, [seasonThirtyNine, laterSeason])).toEqual({
      ...laterSeason,
      playerCount: 0,
      legends: [],
    })
  })

  test('is null before any season start has been seen, since any stored game could be from an old season', async () => {
    expect(await readMostPlayedLegends(database, [seasonThirtyNine])).toBeNull()
  })
})
