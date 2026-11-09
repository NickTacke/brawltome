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

// ivy has two snapshots, but not in consecutive weeks
const ivy: StoredGuild = { clanId: 7006, guildPoints: '20', clanXp: '1', clanLifetimeXp: '1' }

const identityOnlyClanId = 7005
const unknownClanId = 7999

// the guild points each guild had at each weekly snapshot; ember and frost both earn 60 above 2^53, gale's points
// drop, haze has only the latest week, and the newest week hasn't finished yet so it can't count
const weeklySnapshots = [
  { weekStarting: '2026-10-22', completed: true, points: [[ivy.clanId, '10']] },
  {
    weekStarting: '2026-10-29',
    completed: true,
    points: [
      [ember.clanId, '900719925474099300000'],
      [frost.clanId, '900719925474099300000'],
      [gale.clanId, '300'],
    ],
  },
  {
    weekStarting: '2026-11-05',
    completed: true,
    points: [
      [ember.clanId, '900719925474099300060'],
      [frost.clanId, '900719925474099300060'],
      [gale.clanId, '250'],
      [haze.clanId, '50'],
      [ivy.clanId, '20'],
    ],
  },
  { weekStarting: '2026-11-12', completed: false, points: [[ember.clanId, '900719925474099399999']] },
] as const

let database: TestDatabase
let emptyDatabase: TestDatabase

async function storeGuild(guild: StoredGuild, target: TestDatabase = database): Promise<void> {
  await target.sql`INSERT INTO clans.clans (clan_id) VALUES (${guild.clanId})`

  await target.sql`
    INSERT INTO clans.profiles (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, guild_points)
    VALUES (${guild.clanId}, ${`Guild ${guild.clanId}`}, '2024-01-01T00:00:00.000Z', ${guild.clanXp},
            ${guild.clanLifetimeXp}, ${guild.guildPoints})
  `
}

async function storeWeeklySnapshots(): Promise<void> {
  for (const week of weeklySnapshots) {
    await database.sql`
      INSERT INTO clans.weekly_snapshot_runs (week_starting, completed_at)
      VALUES (${week.weekStarting}, ${week.completed ? new Date() : null})
    `

    for (const [clanId, guildPoints] of week.points) {
      await database.sql`
        INSERT INTO clans.weekly_snapshots (week_starting, clan_id, guild_points)
        VALUES (${week.weekStarting}, ${clanId}, ${guildPoints})
      `
    }
  }
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_standing', modules: [queueModule, clanModule] })
  emptyDatabase = await createTestDatabase({ label: 'clan_standing_empty', modules: [queueModule, clanModule] })

  for (const guild of [ember, frost, gale, haze, ivy]) await storeGuild(guild)

  await storeWeeklySnapshots()
  await storeGuild(ember, emptyDatabase)

  await database.sql`INSERT INTO clans.clans (clan_id) VALUES (${identityOnlyClanId})`
}, 20_000)

afterAll(async () => {
  await database?.drop()
  await emptyDatabase?.drop()
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
    expect(await readClanStanding(database, haze.clanId)).toMatchObject({ guildPointsRank: null, lifetimeXpRank: 4 })
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

describe('reading the last week of a guild', () => {
  test('gives the points earned between the two latest finished weeks, and tied guilds one rank', async () => {
    expect(await readClanStanding(database, ember.clanId)).toMatchObject({ lastWeekPoints: '60', lastWeekRank: 1 })
    expect(await readClanStanding(database, frost.clanId)).toMatchObject({ lastWeekPoints: '60', lastWeekRank: 1 })
  })

  test('has no figure for a guild whose points went down', async () => {
    expect(await readClanStanding(database, gale.clanId)).toMatchObject({ lastWeekPoints: null, lastWeekRank: null })
  })

  test('has no figure for a guild with only the latest snapshot', async () => {
    expect(await readClanStanding(database, haze.clanId)).toMatchObject({ lastWeekPoints: null, lastWeekRank: null })
  })

  test('has no figure for a guild whose snapshots are not a week apart', async () => {
    expect(await readClanStanding(database, ivy.clanId)).toMatchObject({ lastWeekPoints: null, lastWeekRank: null })
  })

  test('has no figure before any snapshot was taken', async () => {
    expect(await readClanStanding(emptyDatabase, ember.clanId)).toEqual({
      guildPointsRank: 1,
      lifetimeXpRank: 1,
      lastWeekPoints: null,
      lastWeekRank: null,
    })
  })
})
