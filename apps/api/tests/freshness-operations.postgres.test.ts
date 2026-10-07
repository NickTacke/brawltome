import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_freshness_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''
const admission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for freshness operation tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of refreshOperationsMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 30_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function insertVisitorRefresh(
  sql: ReturnType<typeof postgres>,
  brawlhallaId: number,
  ageDays: number,
  settled: boolean,
): Promise<void> {
  const id = randomUUID()
  await sql`
    INSERT INTO refresh_operations.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts, created_at)
    VALUES
      (${id}, ${id}, 'interactive-player-refresh', ${`visit:${id}`}, ${`visit:${id}`}, 'interactive',
       ${sql.json({ brawlhallaId, staleSections: ['ranked'] })}, ${sql.json({ source: 'interactive-api' })}, 4,
       clock_timestamp() - make_interval(days => ${ageDays}))
  `
  if (settled) {
    await sql`
      UPDATE refresh_operations.operations
      SET status = 'succeeded', completed_at = clock_timestamp()
      WHERE id = ${id}
    `
  }
}

describe('Recently viewed freshness operations', () => {
  test('counts view demand per player within the window', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      for (let index = 0; index < 3; index++) await insertVisitorRefresh(control, 10, 1, true)
      await insertVisitorRefresh(control, 11, 10, true)
      await insertVisitorRefresh(control, 12, 40, true)

      const viewed = await operations.recentlyViewedPlayers({ windowDays: 30, hotDays: 7 })
      expect(viewed.sort((left, right) => left.brawlhallaId - right.brawlhallaId)).toEqual([
        { brawlhallaId: 10, recentViews: 3, views: 3 },
        { brawlhallaId: 11, recentViews: 0, views: 1 },
      ])
    } finally {
      await Promise.all([control.end(), operations.close()])
    }
  })

  test('enqueues background refreshes once per player and skips players with an active refresh', async () => {
    const control = postgres(connectionString, { max: 1 })
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      await insertVisitorRefresh(control, 30, 0, false)

      expect(await operations.enqueueRecentlyViewedRefreshes([20, 21, 30])).toEqual([20, 21])
      expect(await operations.enqueueRecentlyViewedRefreshes([20])).toEqual([])
      expect(await operations.activeRecentlyViewedRefreshes()).toBe(2)

      const [row] = await control<{ work_class: string; payload: unknown; resource_key: string }[]>`
        SELECT work_class, payload, resource_key FROM refresh_operations.operations
        WHERE provenance->>'source' = 'freshness-planner' AND payload->>'brawlhallaId' = '20'
      `
      expect(row).toEqual({
        work_class: 'primary-monitoring',
        payload: { cohort: 'recently-viewed', brawlhallaId: 20, staleSections: ['ranked', 'stats'] },
        resource_key: 'player:20',
      })

      // Interactive work is claimed first, so settle the visitor's refresh to reach the background one.
      await control`
        UPDATE refresh_operations.operations SET status = 'succeeded', completed_at = clock_timestamp()
        WHERE work_class = 'interactive'
      `
      const lease = await operations.claim('worker', 1_000, admission)
      expect(lease).toMatchObject({
        kind: 'interactive-player-refresh',
        workClass: 'primary-monitoring',
        payload: { cohort: 'recently-viewed', staleSections: ['ranked', 'stats'] },
      })
    } finally {
      await Promise.all([control.end(), operations.close()])
    }
  })

  test('rejects primary-monitoring refreshes that have neither an assignment nor the cohort', async () => {
    const control = postgres(connectionString, { max: 1 })
    try {
      const id = randomUUID()
      const insertOrphan = async () => {
        await control`
          INSERT INTO refresh_operations.operations
            (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
          VALUES
            (${id}, ${id}, 'interactive-player-refresh', ${`orphan:${id}`}, ${`orphan:${id}`}, 'primary-monitoring',
             ${control.json({ brawlhallaId: 40, staleSections: ['ranked', 'stats'] })},
             ${control.json({ source: 'test' })}, 4)
        `
      }
      await expect(insertOrphan()).rejects.toThrow('operations_payload_by_kind')
    } finally {
      await control.end()
    }
  })
})
