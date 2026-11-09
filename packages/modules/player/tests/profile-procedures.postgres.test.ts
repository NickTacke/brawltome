import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { call } from '@orpc/server'
import { mapPlayerCareerProfile } from '../api/map-career-profile'
import { mapPlayerRankedProfile } from '../api/map-ranked-profile'
import { createPlayerProcedures } from '../api/procedures'
import {
  createPostgresCareerPlayers,
  createPostgresPlayerReferences,
  createPostgresRankedPlayers,
  playerModule,
} from '../index'

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }
const observedAt = '2026-11-01T12:30:00.000Z'

const storedPlayerId = 201
const unknownPlayerId = 999_999

let database: TestDatabase

async function insertStoredPlayer() {
  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES
      (${storedPlayerId}, 'Stored Player', ${observedAt}, ${observedAt}, 'EU', 2000, 2100, 'Diamond', 40, 90)
  `

  await database.sql`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage,
       games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
       snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES
      (${storedPlayerId}, 'Stored Player', ${observedAt}, ${observedAt}, 'v0-player-snapshot', 10, 1, 0, 5, 3, 600,
       0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `
}

function procedures() {
  return createPlayerProcedures({ database })
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'player_profile_procedures', modules: [queueModule, playerModule] })

  await insertStoredPlayer()
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

describe('player profile procedures', () => {
  test('return null for a player nothing is stored about', async () => {
    const { referenceById, rankedById, careerById } = procedures()
    const input = { id: unknownPlayerId }

    expect(await call(referenceById, input, internalCaller)).toBeNull()
    expect(await call(rankedById, input, internalCaller)).toBeNull()
    expect(await call(careerById, input, internalCaller)).toBeNull()
  })

  test('referenceById returns what the reference queries return', async () => {
    const expected = await createPostgresPlayerReferences(database).byId(storedPlayerId)

    expect(expected?.name).toBe('Stored Player')
    expect(await call(procedures().referenceById, { id: storedPlayerId }, internalCaller)).toEqual(expected)
  })

  test('rankedById returns the mapped ranked profile', async () => {
    const career = createPostgresCareerPlayers(database)

    const ranked = createPostgresRankedPlayers(database, {
      resolveCareerMainLegend: (brawlhallaId) => career.mainLegendById(brawlhallaId),
    })

    const expected = mapPlayerRankedProfile(await ranked.byId(storedPlayerId))

    expect(expected?.brawlhallaId).toBe(storedPlayerId)
    expect(await call(procedures().rankedById, { id: storedPlayerId }, internalCaller)).toEqual(expected)
  })

  test('careerById returns the mapped career profile', async () => {
    const expected = mapPlayerCareerProfile(await createPostgresCareerPlayers(database).byId(storedPlayerId))

    expect(expected?.brawlhallaId).toBe(storedPlayerId)
    expect(await call(procedures().careerById, { id: storedPlayerId }, internalCaller)).toEqual(expected)
  })

  test('reject callers from outside', async () => {
    const { referenceById, rankedById, careerById } = procedures()
    const input = { id: storedPlayerId }

    expect(call(referenceById, input, outsideCaller)).rejects.toThrow()
    expect(call(rankedById, input, outsideCaller)).rejects.toThrow()
    expect(call(careerById, input, outsideCaller)).rejects.toThrow()
  })
})

describe('seasonStarts', () => {
  test('finds a reset from stored rating history', async () => {
    const resetDay = '2026-06-24T15:00:00.000Z'
    const lastWeek = '2026-06-17T15:00:00.000Z'

    for (let brawlhallaId = 1000; brawlhallaId < 1030; brawlhallaId += 1) {
      await database.sql`
        INSERT INTO players.ranked_profiles
          (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
        VALUES (${brawlhallaId}, 'Reset Player', ${resetDay}, ${resetDay}, 'EU', 1500, 1500, 'Gold 1', 1, 2)
      `

      await database.sql`
        INSERT INTO players.ranked_rating_history
          (brawlhalla_id, rating, peak_rating, tier, wins, games, recorded_at)
        SELECT ${brawlhallaId}, 1500, 1500, 'Gold 1', 1, games, recorded_at::timestamptz
        FROM (VALUES (40, ${lastWeek}), (2, ${resetDay})) AS points (games, recorded_at)
      `
    }

    expect(await call(procedures().seasonStarts, undefined, internalCaller)).toEqual([
      { season: 39, startsAt: '1970-01-01T00:00:00.000Z' },
      { season: 40, startsAt: '2026-06-24T14:00:00.000Z' },
    ])
  })

  test('rejects callers from outside', () => {
    expect(call(procedures().seasonStarts, undefined, outsideCaller)).rejects.toThrow()
  })
})
