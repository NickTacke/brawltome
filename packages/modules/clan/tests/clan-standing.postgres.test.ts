import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { readClanStanding } from '../db/read-clan-standing'
import { clanModule } from '../index'

type StoredGuild = {
  clanId: number
  guildPoints: string | null
  clanXp: string
  clanLifetimeXp: string
}

// frost has the most current xp, so adding clan_xp on top of the stored lifetime xp would put it first; ember's
// lifetime xp starts with a lower digit, so comparing the values as text would put it behind frost and gale
const ember: StoredGuild = {
  clanId: 7001,
  guildPoints: '500',
  clanXp: '10',
  clanLifetimeXp: '1801439850948198711110',
}

const frost: StoredGuild = {
  clanId: 7002,
  guildPoints: '500',
  clanXp: '1000000000000000000000',
  clanLifetimeXp: '900000000000000000000',
}

const gale: StoredGuild = { clanId: 7003, guildPoints: '90', clanXp: '10', clanLifetimeXp: '900000000000000000000' }
const haze: StoredGuild = { clanId: 7004, guildPoints: null, clanXp: '10', clanLifetimeXp: '100' }

const identityOnlyClanId = 7005
const unknownClanId = 7999

let database: TestDatabase

async function storeGuild(guild: StoredGuild): Promise<void> {
  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${guild.clanId})`

  await database.sql`
    INSERT INTO clans.profiles (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, guild_points)
    VALUES (${guild.clanId}, ${`Guild ${guild.clanId}`}, '2024-01-01T00:00:00.000Z', ${guild.clanXp},
            ${guild.clanLifetimeXp}, ${guild.guildPoints})
  `
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_standing', modules: [queueModule, clanModule] })

  for (const guild of [ember, frost, gale, haze]) await storeGuild(guild)

  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${identityOnlyClanId})`
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

describe('reading a guild standing', () => {
  test('ranks guild points from highest to lowest', async () => {
    expect((await readClanStanding(database, ember.clanId))?.guildPointsRank).toBe(1)
    expect((await readClanStanding(database, gale.clanId))?.guildPointsRank).toBe(3)
  })

  test('ranks lifetime xp by the stored value clan.byId shows, without adding current xp', async () => {
    expect((await readClanStanding(database, ember.clanId))?.lifetimeXpRank).toBe(1)
    expect((await readClanStanding(database, frost.clanId))?.lifetimeXpRank).toBe(2)
    expect((await readClanStanding(database, haze.clanId))?.lifetimeXpRank).toBe(4)
  })

  test('gives a guild with no guild points a null guild points rank and still ranks its lifetime xp', async () => {
    expect(await readClanStanding(database, haze.clanId)).toEqual({ guildPointsRank: null, lifetimeXpRank: 4 })
  })

  test('gives tied guilds the same guild points rank and counts both for the guild below', async () => {
    expect((await readClanStanding(database, ember.clanId))?.guildPointsRank).toBe(1)
    expect((await readClanStanding(database, frost.clanId))?.guildPointsRank).toBe(1)
    expect((await readClanStanding(database, gale.clanId))?.guildPointsRank).toBe(3)
  })

  test('gives tied guilds the same lifetime xp rank and counts both for the guild below', async () => {
    expect((await readClanStanding(database, frost.clanId))?.lifetimeXpRank).toBe(2)
    expect((await readClanStanding(database, gale.clanId))?.lifetimeXpRank).toBe(2)
    expect((await readClanStanding(database, haze.clanId))?.lifetimeXpRank).toBe(4)
  })

  test('returns null for an unknown guild', async () => {
    expect(await readClanStanding(database, unknownClanId)).toBeNull()
  })

  test('returns null for a guild whose profile was never fetched, as clan.byId does', async () => {
    expect(await readClanStanding(database, identityOnlyClanId)).toBeNull()
  })
})
