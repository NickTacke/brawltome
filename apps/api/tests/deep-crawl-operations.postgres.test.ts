import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { leaderboardDeepCrawlScheduleDefinitions } from '../src/operations-worker-config'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_deep_crawl_${process.pid}_${randomUUID().replaceAll('-', '')}`
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
  if (!baseUrl) throw new Error('DATABASE_URL is required for deep crawl operation tests')
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

describe('Leaderboard deep crawl operations', () => {
  test('reconciles, materializes, and claims one crawl per region schedule', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      const definitions = leaderboardDeepCrawlScheduleDefinitions({
        enabled: true,
        intervalMs: 3 * 60 * 60 * 1000,
        firstDueAt: '2020-01-01T00:07:00.000Z',
      })
      for (const definition of definitions) {
        expect((await operations.reconcileLeaderboardDeepCrawlSchedule(definition)).outcome).toBe('created')
        expect((await operations.reconcileLeaderboardDeepCrawlSchedule(definition)).outcome).toBe('already-exists')
      }
      expect(await operations.disableLeaderboardDeepCrawlSchedule(definitions[8].scheduleKey)).toEqual({
        outcome: 'disabled',
      })

      await operations.materializeDueSchedules()
      const control = postgres(connectionString, { max: 1 })
      try {
        const keys = await control<{ dedupe_key: string; schedule_id: string }[]>`
          SELECT operation.dedupe_key, occurrence.schedule_id
          FROM refresh_operations.operations operation
          JOIN refresh_operations.schedule_occurrences occurrence
            ON occurrence.id = operation.origin_schedule_occurrence_id
          WHERE operation.kind = 'leaderboard-deep-crawl'
        `
        // Eight enabled regions, each keyed to its schedule so a later window cannot stack a second crawl.
        expect(keys).toHaveLength(8)
        for (const { dedupe_key, schedule_id } of keys) expect(dedupe_key).toBe(`schedule:${schedule_id}:deep-crawl`)
      } finally {
        await control.end()
      }
      const lease = await operations.claim('worker', 1_000, admission)
      expect(lease).toMatchObject({
        kind: 'leaderboard-deep-crawl',
        workClass: 'leaderboard',
        payload: { region: expect.any(String), intervalMs: 3 * 60 * 60 * 1000 },
      })
    } finally {
      await operations.close()
    }
  })

  test('rejects deep crawl rows outside the regional scopes or with extra fields', async () => {
    const control = postgres(connectionString, { max: 1 })
    try {
      const insert = async (payload: Record<string, unknown>) => {
        const id = randomUUID()
        await control`
          INSERT INTO refresh_operations.operations
            (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
          VALUES
            (${id}, ${id}, 'leaderboard-deep-crawl', ${`crawl:${id}`}, ${`crawl:${id}`}, 'leaderboard',
             ${control.json(payload)}, ${control.json({ source: 'test' })}, 3)
        `
      }
      await insert({ region: 'EU', intervalMs: 10_800_000 })
      await expect(insert({ region: 'all', intervalMs: 10_800_000 })).rejects.toThrow('operations_payload_by_kind')
      await expect(insert({ region: 'EU', intervalMs: 60_000 })).rejects.toThrow('operations_payload_by_kind')
      await expect(insert({ region: 'EU', intervalMs: 10_800_000, page: 3 })).rejects.toThrow(
        'operations_payload_by_kind',
      )
    } finally {
      await control.end()
    }
  })

  test('saves and replaces crawl progress per region', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    try {
      expect(await operations.readLeaderboardDeepCrawlProgress('EU')).toBeNull()
      const windowAt = new Date('2026-10-07T16:00:00.000Z')
      await operations.saveLeaderboardDeepCrawlProgress({ region: 'EU', windowAt, nextPage: 41, totalPages: 1630 })
      await operations.saveLeaderboardDeepCrawlProgress({ region: 'EU', windowAt, nextPage: 141, totalPages: 1630 })
      expect(await operations.readLeaderboardDeepCrawlProgress('EU')).toEqual({
        windowAt,
        nextPage: 141,
        totalPages: 1630,
      })
    } finally {
      await operations.close()
    }
  })
})
