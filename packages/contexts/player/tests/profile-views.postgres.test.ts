import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createPostgresProfileViews, playerMigrationInventory } from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_views_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Player PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of playerMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

describe('Profile view demand', () => {
  test('counts views per player and day, reports distinct days in the window, and trims old days', async () => {
    const control = postgres(connectionString, { max: 1 })
    const views = createPostgresProfileViews(connectionString)
    try {
      await views.recordView(1)
      await views.recordView(1)
      await views.recordView(2)
      await views.recordView(0)
      await control`
        INSERT INTO players.profile_view_days (day, brawlhalla_id, views)
        VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date - 3, 1, 4),
               ((clock_timestamp() AT TIME ZONE 'UTC')::date - 20, 3, 1),
               ((clock_timestamp() AT TIME ZONE 'UTC')::date - 40, 4, 1)
      `
      const [today] = await control<{ views: number }[]>`
        SELECT views FROM players.profile_view_days
        WHERE brawlhalla_id = 1 AND day = (clock_timestamp() AT TIME ZONE 'UTC')::date
      `
      expect(today.views).toBe(2)

      const demand = await views.viewDemand({ days: 14 })
      expect(
        demand
          .map(({ brawlhallaId, viewDays }) => ({ brawlhallaId, viewDays }))
          .sort((left, right) => left.brawlhallaId - right.brawlhallaId),
      ).toEqual([
        { brawlhallaId: 1, viewDays: 2 },
        { brawlhallaId: 2, viewDays: 1 },
      ])

      expect(await views.trim({ keepDays: 30 })).toBe(1)
      expect(
        (await control<{ brawlhalla_id: number }[]>`SELECT brawlhalla_id FROM players.profile_view_days`).map(
          ({ brawlhalla_id }) => brawlhalla_id,
        ),
      ).not.toContain(4)
    } finally {
      await Promise.all([control.end(), views.close()])
    }
  })
})
