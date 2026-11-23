import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { playerEsportsSchema } from '@brawltome/contracts'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { playerModule } from '@brawltome/player'
import { acceptOperation, queueModule } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { call } from '@orpc/server'
import { createEsportsProcedures } from '../api/procedures'
import { readPlayerEsports } from '../api/read-player-esports'
import { recordFailure } from '../db/record-failure'
import { saveEventSets } from '../db/save-event-sets'
import { type RefreshInput, saveRefresh } from '../db/save-refresh'
import { esportsModule, esportsRefreshContract } from '../index'
import { createEsportsRefreshJob } from '../jobs/esports-refresh-job'
import { match, placement, powerRanking } from './domain/builders'
import { answers, createQueue, createSourceAdmission, stubClient } from './jobs/job-harness'

const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000
const now = new Date('2026-11-23T12:00:00Z')

const internalCaller = { context: { isInternalCaller: true } }
const outsideCaller = { context: { isInternalCaller: false } }

const frostbyte = placement({ tournamentId: 'frostbyte-19/1v1', tournamentName: 'Frostbyte #19', placement: 3 })

let database: TestDatabase
// each test stores its own players, so none of them sees another test's rows
let nextBrawlhallaId = 5_000

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'esports_read',
    modules: [queueModule, playerModule, esportsModule],
  })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

// the reads queue refreshes, and a test that runs one must find only its own
beforeEach(async () => {
  await database.sql`DELETE FROM queue.attempts`
  await database.sql`DELETE FROM queue.operations`
})

function newPlayerId(): number {
  nextBrawlhallaId += 1

  return nextBrawlhallaId
}

function ago(durationMs: number): Date {
  return new Date(now.getTime() - durationMs)
}

async function storeLinked(brawlhallaId: number, overrides: Partial<RefreshInput> = {}) {
  await saveRefresh(database, {
    brawlhallaId,
    link: 'linked',
    player: { playerId: 77, name: 'Ember', brawlhallaId },
    pr1v1: powerRanking({ earnings: 120, rank: 14, region: 'EU' }),
    pr2v2: null,
    placements: [frostbyte],
    eventLegends: [{ name: 'Mordex', count: 3 }],
    checkedAt: ago(dayMs),
    ...overrides,
  })

  await saveEventSets(database, brawlhallaId, frostbyte.tournamentId, [match({ scores: [3, 1] })], ago(dayMs))
}

async function storeNone(brawlhallaId: number, checkedAt: Date) {
  await saveRefresh(database, {
    brawlhallaId,
    link: 'none',
    player: null,
    pr1v1: null,
    pr2v2: null,
    placements: [],
    eventLegends: [],
    checkedAt,
  })
}

// the account as the player module knows it: its name and 1v1 region from ranked
async function storeRankedAccount(brawlhallaId: number, name: string, region: string) {
  await database.sql`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games)
    VALUES (${brawlhallaId}, ${name}, ${now}, ${now}, ${region}, 2000, 2100, 'Diamond', 1, 2)
  `
}

async function storeAlias(brawlhallaId: number, alias: string) {
  await database.sql`
    INSERT INTO players.discovery_aliases (brawlhalla_id, normalized_alias, display_alias, observed_at)
    VALUES (${brawlhallaId}, ${alias.toLowerCase()}, ${alias}, ${now})
  `
}

// career legends in the order given, each with its games; the read ranks them by games, not by this order
async function storeCareerLegends(brawlhallaId: number, name: string, legends: { key: string; games: number }[]) {
  await database.sql`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, snapshot_source, xp, level, xp_percentage,
       games, wins, match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick,
       snowball_hits, bomb_kos, mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES (${brawlhallaId}, ${name}, ${now}, ${now}, 'v0-player-snapshot', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0)
  `

  for (const [ordinal, legend] of legends.entries()) {
    await database.sql`
      INSERT INTO players.career_legends
        (brawlhalla_id, ordinal, legend_id, legend_name_key, xp, level, xp_percentage, games, wins, match_time,
         kos, falls, suicides, team_kos, damage_dealt, damage_taken, damage_unarmed, ko_unarmed,
         damage_thrown_item, ko_thrown_item, damage_gadgets, ko_gadgets, damage_weapon_one, ko_weapon_one,
         time_held_weapon_one, damage_weapon_two, ko_weapon_two, time_held_weapon_two)
      VALUES (${brawlhallaId}, ${ordinal}, ${ordinal + 1}, ${legend.key}, 0, 0, 0, ${legend.games}, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    `
  }
}

// an esports record with no name in common with the account, trusted only by where and what the player plays
async function storeRecordKnownByPlay(brawlhallaId: number) {
  await storeLinked(brawlhallaId, {
    player: { playerId: 78, name: 'Zephyrine', brawlhallaId },
    // no 1v1 power ranking, so the region is the one of the 2v2 ranking
    pr1v1: powerRanking({ earnings: 40 }),
    pr2v2: powerRanking({ earnings: 40, rank: 30, region: 'EU' }),
    eventLegends: [
      { name: 'Teros', count: 9 },
      { name: 'Hattori', count: 5 },
      { name: 'Mordex', count: 2 },
    ],
  })
}

type QueuedOperation = { status: string; workClass: string; resourceKey: string | null; payload: unknown }

async function readQueued(kind: string, brawlhallaId: number): Promise<QueuedOperation[]> {
  return database.sql<QueuedOperation[]>`
    SELECT status, work_class AS "workClass", resource_key AS "resourceKey", payload
    FROM queue.operations WHERE kind = ${kind} AND dedupe_key = ${`${kind}:${brawlhallaId}`}
  `
}

// the refresh job against a brawltools that does not know the player
async function runNoneRefresh() {
  const job = createEsportsRefreshJob({
    database,
    createClient: stubClient(answers({ player: null }), []),
    enqueueBackfill: async () => {},
  })

  return runJobOnce(createQueue(database, job), job, { sourceAdmission: createSourceAdmission().sourceAdmission })
}

// active refreshes of other players, as many as the read allows before it stops queueing
async function fillRefreshBacklog(count: number) {
  for (let index = 1; index <= count; index += 1) {
    const brawlhallaId = 900_000 + index

    await acceptOperation(database, {
      job: esportsRefreshContract,
      dedupeKey: `esports-refresh:${brawlhallaId}`,
      operationKey: `esports-refresh:${brawlhallaId}`,
      resourceKey: `esports-refresh:${brawlhallaId}`,
      workClass: 'maintenance',
      payload: { brawlhallaId },
      provenance: { source: 'integration-test' },
    })
  }
}

const fillerLegends = ['ada', 'bodvar', 'cassidy', 'orion', 'gnash', 'scarlet', 'thatch'].map((key, index) => ({
  key,
  games: 100 + index,
}))

describe('readPlayerEsports', () => {
  test('shows the shaped profile of a link whose name matches the account', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    const { profile, freshness } = await readPlayerEsports(database, brawlhallaId, now)

    expect(freshness).toBe('fresh')

    expect(profile).toMatchObject({
      earnings: 120,
      rankings: [{ mode: '1v1', rank: 14, region: 'EU' }],
      results: [{ fullName: 'Frostbyte #19', placement: 3, setRecord: { wins: 1, losses: 0 } }],
    })
  })

  test('untrusted link → profile null', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Quartz', 'US-E')

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'fresh' })
  })

  test('a link to an account the player module does not know → profile null', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId)

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'fresh' })
  })

  test('a new alias that matches makes the profile appear', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Quartz', 'US-E')

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).toBeNull()

    await storeAlias(brawlhallaId, 'LGN | Ember')

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).not.toBeNull()
  })

  test('trusts a link by region and two of the top three event legends among the top 8 by games', async () => {
    const brawlhallaId = newPlayerId()

    // listed after the fillers, so only a read that ranks by games has both in its top 8
    const mostPlayed = [
      { key: 'teros', games: 900 },
      { key: 'hattori', games: 800 },
    ]

    await storeRecordKnownByPlay(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Quartz', 'EU')
    await storeCareerLegends(brawlhallaId, 'Quartz', [...fillerLegends, ...mostPlayed])

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).not.toBeNull()
  })

  test('leaves out the legends below the top 8 by games', async () => {
    const brawlhallaId = newPlayerId()

    // listed first, so a read that took the first 8 as listed would count both
    const rarelyPlayed = [
      { key: 'teros', games: 1 },
      { key: 'hattori', games: 2 },
    ]

    await storeRecordKnownByPlay(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Quartz', 'EU')
    await storeCareerLegends(brawlhallaId, 'Quartz', [...rarelyPlayed, ...fillerLegends])

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).toBeNull()
  })

  test('does not trust play from another region', async () => {
    const brawlhallaId = newPlayerId()

    await storeRecordKnownByPlay(brawlhallaId)
    await storeRankedAccount(brawlhallaId, 'Quartz', 'SEA')

    await storeCareerLegends(brawlhallaId, 'Quartz', [
      { key: 'teros', games: 900 },
      { key: 'hattori', games: 800 },
    ])

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).toBeNull()
  })

  test('trusts a Lin Fei main by region and legends, though brawltools writes the names with an underscore', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId, {
      player: { playerId: 79, name: 'Zephyrine', brawlhallaId },
      eventLegends: [
        { name: 'LIN_FEI', count: 9 },
        { name: 'QUEEN_NAI', count: 4 },
        { name: 'MORDEX', count: 1 },
      ],
    })

    await storeRankedAccount(brawlhallaId, 'Quartz', 'EU')

    await storeCareerLegends(brawlhallaId, 'Quartz', [
      { key: 'lin fei', games: 900 },
      { key: 'queen nai', games: 800 },
    ])

    expect((await readPlayerEsports(database, brawlhallaId, now)).profile).not.toBeNull()
  })

  test('answers within the contract when stored sets hold the whole opponent brawltools sends', async () => {
    const brawlhallaId = newPlayerId()
    const opponent = { playerId: 31, sggPlayerId: 4_101, cmPlayerId: null, brawlhallaId: 7_788, name: 'Sandstorm' }
    const set = match({ scores: [3, 1], opponent: [opponent] })

    await storeLinked(brawlhallaId)
    await saveEventSets(database, brawlhallaId, frostbyte.tournamentId, [set], ago(dayMs))
    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    const esports = await readPlayerEsports(database, brawlhallaId, now)

    expect(playerEsportsSchema.parse(esports)).toEqual(esports)
    expect(esports.profile?.results[0]?.sets[0]?.opponents).toEqual([{ brawlhallaId: 7_788, name: 'Sandstorm' }])
  })

  test('a trusted link with no placement to show → profile null', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId, { placements: [] })
    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'fresh' })
  })

  test('none checked 10 days ago is fresh; linked checked 8 days ago is stale; never checked is missing', async () => {
    const none = newPlayerId()
    const linked = newPlayerId()
    const neverChecked = newPlayerId()

    await storeNone(none, ago(10 * dayMs))
    await storeLinked(linked, { checkedAt: ago(8 * dayMs) })
    await storeRankedAccount(linked, 'Ember', 'EU')

    expect(await readPlayerEsports(database, none, now)).toEqual({ profile: null, freshness: 'fresh' })
    expect(await readPlayerEsports(database, linked, now)).toMatchObject({ freshness: 'stale' })
    expect((await readPlayerEsports(database, linked, now)).profile).not.toBeNull()
    expect(await readPlayerEsports(database, neverChecked, now)).toEqual({ profile: null, freshness: 'missing' })
  })

  test('none checked 31 days ago is stale; linked checked 6 days ago is fresh', async () => {
    const none = newPlayerId()
    const linked = newPlayerId()

    await storeNone(none, ago(31 * dayMs))
    await storeLinked(linked, { checkedAt: ago(6 * dayMs) })

    expect(await readPlayerEsports(database, none, now)).toMatchObject({ freshness: 'stale' })
    expect(await readPlayerEsports(database, linked, now)).toMatchObject({ freshness: 'fresh' })
  })

  test('a failure inside the back-off is fresh, and the stored profile still shows', async () => {
    const linked = newPlayerId()
    const firstTry = newPlayerId()

    await storeLinked(linked, { checkedAt: ago(8 * dayMs) })
    await storeRankedAccount(linked, 'Ember', 'EU')
    await recordFailure(database, linked, ago(12 * hourMs))
    await recordFailure(database, firstTry, ago(12 * hourMs))

    const { profile, freshness } = await readPlayerEsports(database, linked, now)

    expect(freshness).toBe('fresh')
    expect(profile).not.toBeNull()
    expect(await readPlayerEsports(database, firstTry, now)).toEqual({ profile: null, freshness: 'fresh' })
  })

  test('a failure past the back-off is stale, though the link would still be fresh', async () => {
    const linked = newPlayerId()
    const firstTry = newPlayerId()

    await storeLinked(linked)
    await recordFailure(database, linked, ago(2 * dayMs))
    // a first fetch that failed stores a 'none' row, which must not wait 30 days for the next try
    await recordFailure(database, firstTry, ago(2 * dayMs))

    expect(await readPlayerEsports(database, linked, now)).toMatchObject({ freshness: 'stale' })
    expect(await readPlayerEsports(database, firstTry, now)).toMatchObject({ freshness: 'stale' })
  })
})

describe('readPlayerEsports queueing', () => {
  test('a stale read queues one refresh, a second read while it is pending queues nothing', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId, { checkedAt: ago(8 * dayMs) })
    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    const first = await readPlayerEsports(database, brawlhallaId, now)
    const second = await readPlayerEsports(database, brawlhallaId, now)

    expect(first.freshness).toBe('stale')
    expect(second.profile).not.toBeNull()

    expect(await readQueued('esports-refresh', brawlhallaId)).toEqual([
      {
        status: 'pending',
        workClass: 'maintenance',
        resourceKey: `esports-refresh:${brawlhallaId}`,
        payload: { brawlhallaId },
      },
    ])
  })

  test('a read of a player never fetched queues one refresh', async () => {
    const brawlhallaId = newPlayerId()

    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'missing' })
    expect(await readQueued('esports-refresh', brawlhallaId)).toHaveLength(1)
  })

  test('a read of an id the player module does not know queues nothing', async () => {
    const brawlhallaId = newPlayerId()

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'missing' })
    expect(await readQueued('esports-refresh', brawlhallaId)).toEqual([])
  })

  test('a read queues nothing once 500 refreshes are waiting', async () => {
    const brawlhallaId = newPlayerId()

    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')
    await fillRefreshBacklog(500)

    expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'missing' })
    expect(await readQueued('esports-refresh', brawlhallaId)).toEqual([])
  }, 30_000)

  test('a read queues a refresh while fewer than 500 are waiting', async () => {
    const brawlhallaId = newPlayerId()

    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')
    await fillRefreshBacklog(499)

    await readPlayerEsports(database, brawlhallaId, now)

    expect(await readQueued('esports-refresh', brawlhallaId)).toHaveLength(1)
  }, 30_000)

  test('a fresh read queues nothing', async () => {
    const linked = newPlayerId()
    const none = newPlayerId()
    const backingOff = newPlayerId()

    await storeLinked(linked, { checkedAt: ago(6 * dayMs) })
    await storeNone(none, ago(29 * dayMs))
    await recordFailure(database, backingOff, ago(12 * hourMs))

    for (const brawlhallaId of [linked, none, backingOff]) {
      expect((await readPlayerEsports(database, brawlhallaId, now)).freshness).toBe('fresh')
      expect(await readQueued('esports-refresh', brawlhallaId)).toEqual([])
    }
  })

  test('a none player viewed 100 times in 30 days queues nothing after the first refresh', async () => {
    const brawlhallaId = newPlayerId()

    await storeRankedAccount(brawlhallaId, 'Quartz', 'EU')
    await readPlayerEsports(database, brawlhallaId, new Date())

    expect(await runNoneRefresh()).toBe('succeeded')

    const refreshedAt = Date.now()

    for (let view = 0; view < 100; view += 1) {
      const viewedAt = new Date(refreshedAt + (view * 30 * dayMs) / 100)

      await readPlayerEsports(database, brawlhallaId, viewedAt)
    }

    expect((await readQueued('esports-refresh', brawlhallaId)).map(({ status }) => status)).toEqual(['succeeded'])
  })

  test('a refresh that cannot be queued is logged, and the read still answers', async () => {
    const brawlhallaId = newPlayerId()
    const errors = spyOn(console, 'error').mockImplementation(() => undefined)

    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    await database.sql`
      ALTER TABLE queue.operations ADD CONSTRAINT test_no_esports_refresh CHECK (kind <> 'esports-refresh') NOT VALID
    `

    try {
      expect(await readPlayerEsports(database, brawlhallaId, now)).toEqual({ profile: null, freshness: 'missing' })
      expect(errors).toHaveBeenCalledTimes(1)
      expect(String(errors.mock.calls[0]?.[0])).toContain(`esports refresh for player ${brawlhallaId}`)
    } finally {
      errors.mockRestore()
      await database.sql`ALTER TABLE queue.operations DROP CONSTRAINT test_no_esports_refresh`
    }
  })
})

describe('esports.byPlayerId', () => {
  test('answers with the stored profile and its freshness', async () => {
    const brawlhallaId = newPlayerId()

    await storeLinked(brawlhallaId, { checkedAt: new Date() })
    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    const { byPlayerId } = createEsportsProcedures({ database })
    const esports = await call(byPlayerId, { id: brawlhallaId }, internalCaller)

    expect(esports.freshness).toBe('fresh')
    expect(esports.profile?.results.map((result) => result.fullName)).toEqual(['Frostbyte #19'])
    expect(esports.profile?.results[0]?.sets[0]?.opponents).toEqual([{ brawlhallaId: null, name: 'Opponent' }])
  })

  test('queues a refresh for a player never fetched', async () => {
    const brawlhallaId = newPlayerId()
    const { byPlayerId } = createEsportsProcedures({ database })

    await storeRankedAccount(brawlhallaId, 'Ember', 'EU')

    const esports = await call(byPlayerId, { id: brawlhallaId }, internalCaller)

    expect(esports).toEqual({ profile: null, freshness: 'missing' })
    expect(await readQueued('esports-refresh', brawlhallaId)).toHaveLength(1)
  })

  test('rejects callers from outside', async () => {
    const { byPlayerId } = createEsportsProcedures({ database })

    await expect(call(byPlayerId, { id: 1 }, outsideCaller)).rejects.toThrow()
  })
})
