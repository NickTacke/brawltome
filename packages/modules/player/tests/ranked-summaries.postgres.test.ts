import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { createPlayerProcedures } from '../api/procedures'
import { playerModule } from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }
const lastSuccessAt = '2026-11-01T12:30:00.000Z'

const ratedPlayerId = 101
const zeroRatedPlayerId = 102
const neverSucceededPlayerId = 103
const noMainLegendPlayerId = 104
const unknownPlayerId = 999_999

type RatedProfile = {
  brawlhallaId: number
  rating: number
  mainLegend: { id: number; nameKey: string } | null
}

let database: TestDatabase

async function insertRatedProfile({ brawlhallaId, rating, mainLegend }: RatedProfile) {
  await database.sql`
    INSERT INTO players.ranked_profiles (
      brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
      ranked_main_legend_id, ranked_main_legend_name_key
    )
    VALUES (
      ${brawlhallaId}, 'Rated Player', ${lastSuccessAt}, ${lastSuccessAt}, 'EU', ${rating}, ${rating + 50}, 'Gold 3',
      40, 90, ${mainLegend?.id ?? null}, ${mainLegend?.nameKey ?? null}
    )
  `
}

// a player the refresh checked but never got a ranked snapshot for: every snapshot column is null
async function insertNeverSucceededProfile(brawlhallaId: number) {
  await database.sql`
    INSERT INTO players.ranked_profiles (brawlhalla_id, checked_at)
    VALUES (${brawlhallaId}, ${lastSuccessAt})
  `
}

function createProcedures() {
  return createPlayerProcedures({ database })
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_ranked_summaries', modules: [queueModule, playerModule] })

  await insertRatedProfile({
    brawlhallaId: ratedPlayerId,
    rating: 1750,
    mainLegend: { id: 3, nameKey: 'bodvar' },
  })

  await insertRatedProfile({ brawlhallaId: zeroRatedPlayerId, rating: 0, mainLegend: null })
  await insertRatedProfile({ brawlhallaId: noMainLegendPlayerId, rating: 1200, mainLegend: null })
  await insertNeverSucceededProfile(neverSucceededPlayerId)
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('player.rankedSummaries', () => {
  test('returns the stored summary of a player', async () => {
    const summaries = await call(createProcedures().rankedSummaries, { ids: [ratedPlayerId] }, internalCaller)

    expect(summaries).toEqual([
      {
        brawlhallaId: ratedPlayerId,
        rating: 1750,
        wins: 40,
        games: 90,
        mainLegend: 'bodvar',
        updatedAt: lastSuccessAt,
      },
    ])
  })

  test('a stored rating of 0 comes back as null', async () => {
    const [summary] = await call(createProcedures().rankedSummaries, { ids: [zeroRatedPlayerId] }, internalCaller)

    expect(summary.rating).toBeNull()
    expect(summary.games).toBe(90)
  })

  test('ids with no row are left out', async () => {
    const summaries = await call(
      createProcedures().rankedSummaries,
      { ids: [ratedPlayerId, unknownPlayerId] },
      internalCaller,
    )

    expect(summaries.map(({ brawlhallaId }) => brawlhallaId)).toEqual([ratedPlayerId])
  })

  test('an id list with no rows returns an empty list', async () => {
    const summaries = await call(createProcedures().rankedSummaries, { ids: [unknownPlayerId] }, internalCaller)

    expect(summaries).toEqual([])
  })

  test('duplicate ids return one row', async () => {
    const summaries = await call(
      createProcedures().rankedSummaries,
      { ids: [ratedPlayerId, ratedPlayerId, ratedPlayerId] },
      internalCaller,
    )

    expect(summaries).toHaveLength(1)
  })

  test('a row with null wins, games and main legend does not throw', async () => {
    const summaries = await call(createProcedures().rankedSummaries, { ids: [neverSucceededPlayerId] }, internalCaller)

    expect(summaries).toEqual([
      { brawlhallaId: neverSucceededPlayerId, rating: null, wins: 0, games: 0, mainLegend: null, updatedAt: null },
    ])
  })

  test('a rated player without a main legend has a null main legend', async () => {
    const [summary] = await call(createProcedures().rankedSummaries, { ids: [noMainLegendPlayerId] }, internalCaller)

    expect(summary.mainLegend).toBeNull()
    expect(summary.rating).toBe(1200)
  })

  test('250 ids are accepted', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1)

    await expect(call(createProcedures().rankedSummaries, { ids }, internalCaller)).resolves.toBeArray()
  })

  test('251 ids are rejected', async () => {
    const ids = Array.from({ length: 251 }, (_, index) => index + 1)

    const refused = call(createProcedures().rankedSummaries, { ids }, internalCaller)

    await expect(refused).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
  })

  test('an empty id list is rejected', async () => {
    const refused = call(createProcedures().rankedSummaries, { ids: [] }, internalCaller)

    await expect(refused).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
  })

  test('an id that is not a valid Brawlhalla id is rejected', async () => {
    for (const id of [0, -1, 1.5, 2_147_483_648]) {
      const refused = call(createProcedures().rankedSummaries, { ids: [id] }, internalCaller)

      await expect(refused, `id ${id}`).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 })
    }
  })

  test('the read is internal only', async () => {
    const refused = call(createProcedures().rankedSummaries, { ids: [ratedPlayerId] }, outsideCaller)

    await expect(refused).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})
