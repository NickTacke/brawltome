import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { readRankedClans } from '../api/read-ranked-clans'
import { readClanStanding } from '../db/read-clan-standing'
import { clanModule } from '../index'

type StoredGuild = { clanId: number; guildPoints: string | null; clanLifetimeXp: string; memberCount: number }

const pageSize = 30

// first has more points than second only when they compare as numbers, not as text or as doubles
const first: StoredGuild = {
  clanId: 8001,
  guildPoints: '9007199254740993',
  clanLifetimeXp: '1801439850948198711110',
  memberCount: 2,
}

const second: StoredGuild = { clanId: 8002, guildPoints: '9007199254740992', clanLifetimeXp: '5', memberCount: 0 }

// the lower id of two tied guilds comes first, and both count for the guild below them
const tiedHigher: StoredGuild = { clanId: 8003, guildPoints: '500', clanLifetimeXp: '30', memberCount: 1 }
const tiedLower: StoredGuild = { clanId: 8004, guildPoints: '500', clanLifetimeXp: '40', memberCount: 0 }
const belowTie: StoredGuild = { clanId: 8005, guildPoints: '400', clanLifetimeXp: '20', memberCount: 0 }

// a filler per place, enough to spread the ranked guilds over a second page
const fillerGuilds: StoredGuild[] = Array.from({ length: pageSize }, (_, index) => ({
  clanId: 8100 + index,
  guildPoints: String(300 - index),
  clanLifetimeXp: '1',
  memberCount: 0,
}))

const noPoints: StoredGuild = { clanId: 8006, guildPoints: null, clanLifetimeXp: '10', memberCount: 0 }
const storedGuilds = [first, second, tiedHigher, tiedLower, belowTie, ...fillerGuilds, noPoints]

const identityOnlyClanId = 8099

let emptyDatabase: TestDatabase
let database: TestDatabase

async function storeGuild(guild: StoredGuild): Promise<void> {
  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${guild.clanId})`

  await database.sql`
    INSERT INTO clans.profiles (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, guild_points)
    VALUES (${guild.clanId}, ${`Guild ${guild.clanId}`}, '2024-01-01T00:00:00.000Z', '1', ${guild.clanLifetimeXp},
            ${guild.guildPoints})
  `

  for (let index = 0; index < guild.memberCount; index += 1) {
    await database.sql`
      INSERT INTO clans.members (clan_id, brawlhalla_id, xp)
      VALUES (${guild.clanId}, ${guild.clanId * 10 + index}, '1')
    `
  }
}

beforeAll(async () => {
  emptyDatabase = await createTestDatabase({ label: 'ranked_clans_empty', modules: [queueModule, clanModule] })
  database = await createTestDatabase({ label: 'ranked_clans', modules: [queueModule, clanModule] })

  for (const guild of storedGuilds) await storeGuild(guild)

  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${identityOnlyClanId})`
}, 20_000)

afterAll(async () => {
  await emptyDatabase?.drop()
  await database?.drop()
}, 20_000)

describe('reading the ranked guild list', () => {
  test('has no rows and no further page when no guild is stored', async () => {
    expect(await readRankedClans(emptyDatabase, 1)).toEqual({
      page: 1,
      pageSize,
      hasMore: false,
      totalRows: 0,
      entries: [],
    })
  })

  test('orders guild points as numbers, with the columns the guilds table shows', async () => {
    const { entries } = await readRankedClans(database, 1)

    expect(entries[0]).toEqual({
      rank: 1,
      clanId: first.clanId,
      clanName: 'Guild 8001',
      guildPoints: first.guildPoints,
      lifetimeXp: first.clanLifetimeXp,
      memberCount: 2,
    })

    expect(entries[1]).toMatchObject({ rank: 2, clanId: second.clanId })
  })

  test('counts the members of each guild and keeps a guild with none', async () => {
    const { entries } = await readRankedClans(database, 1)

    expect(entries.find(({ clanId }) => clanId === tiedHigher.clanId)?.memberCount).toBe(1)
    expect(entries.find(({ clanId }) => clanId === second.clanId)?.memberCount).toBe(0)
  })

  test('gives tied guilds one rank, the lower id first, and counts both for the guild below', async () => {
    const { entries } = await readRankedClans(database, 1)

    expect(entries.slice(2, 5).map(({ rank, clanId }) => ({ rank, clanId }))).toEqual([
      { rank: 3, clanId: tiedHigher.clanId },
      { rank: 3, clanId: tiedLower.clanId },
      { rank: 5, clanId: belowTie.clanId },
    ])
  })

  test('caps a page at 30 rows and reports the guilds left', async () => {
    const firstPage = await readRankedClans(database, 1)

    expect(firstPage.entries).toHaveLength(pageSize)
    expect(firstPage).toMatchObject({ page: 1, pageSize, hasMore: true, totalRows: storedGuilds.length })
  })

  test('keeps counting ranks across pages', async () => {
    const firstPage = await readRankedClans(database, 1)
    const secondPage = await readRankedClans(database, 2)
    const lastOfFirst = firstPage.entries.at(-1)

    expect(secondPage.entries[0]?.rank).toBe((lastOfFirst?.rank ?? 0) + 1)
    expect(secondPage).toMatchObject({ page: 2, pageSize, hasMore: false, totalRows: storedGuilds.length })
  })

  test('puts a guild with no guild points last, with no rank', async () => {
    const { entries } = await readRankedClans(database, 2)

    expect(entries.at(-1)).toMatchObject({ rank: null, clanId: noPoints.clanId, guildPoints: null })
  })

  test('agrees with the rank the guild standing gives', async () => {
    const { entries } = await readRankedClans(database, 1)

    for (const entry of entries) {
      const standing = await readClanStanding(database, entry.clanId)

      expect(entry.rank).toBe(standing?.guildPointsRank ?? null)
    }
  })

  test('leaves out a guild whose profile was never fetched', async () => {
    const pages = [await readRankedClans(database, 1), await readRankedClans(database, 2)]
    const listedIds = pages.flatMap(({ entries }) => entries.map(({ clanId }) => clanId))

    expect(listedIds).not.toContain(identityOnlyClanId)
  })

  test('returns no rows past the last page and still reports the total', async () => {
    expect(await readRankedClans(database, 3)).toEqual({
      page: 3,
      pageSize,
      hasMore: false,
      totalRows: storedGuilds.length,
      entries: [],
    })
  })
})
