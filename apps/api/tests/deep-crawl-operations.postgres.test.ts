import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations, queueModule } from '@brawltome/queue'
import {
  createLeaderboardDeepCrawlProgress,
  disableLeaderboardDeepCrawlSchedule,
  leaderboardDeepCrawlContract,
  rankingModule,
  reconcileLeaderboardDeepCrawlSchedule,
} from '@brawltome/ranking'
import postgres from 'postgres'
import { leaderboardDeepCrawlScheduleDefinitions } from '../src/operations-worker-config'

let database: TestDatabase
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
  database = await createTestDatabase({
    label: 'deep_crawl_operations',
    modules: [queueModule, rankingModule],
  })

  connectionString = database.connectionString
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('Leaderboard deep crawl operations', () => {
  test('reconciles, materializes, and claims one crawl per region schedule', async () => {
    const operations = createPostgresRefreshOperations({ database }, { jobs: [leaderboardDeepCrawlContract] })

    const definitions = leaderboardDeepCrawlScheduleDefinitions({
      enabled: true,
      intervalMs: 3 * 60 * 60 * 1000,
      firstDueAt: '2020-01-01T00:07:00.000Z',
      pageDelayMs: 0,
      soloIntervalMs: 3 * 60 * 60 * 1000,
      teamsIntervalMs: 3 * 60 * 60 * 1000,
    })

    for (const definition of definitions) {
      expect((await reconcileLeaderboardDeepCrawlSchedule(database, definition)).outcome).toBe('created')
      expect((await reconcileLeaderboardDeepCrawlSchedule(database, definition)).outcome).toBe('already-exists')
    }

    expect(await disableLeaderboardDeepCrawlSchedule(database, definitions[8].scheduleKey)).toEqual({
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

      // Every enabled region and mode, each keyed to its schedule so a later window cannot stack a second crawl.
      expect(keys).toHaveLength(definitions.length - 1)
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
  })

  test('the deep crawl payload is limited to its region, interval and mode', () => {
    const parse = (payload: unknown) => leaderboardDeepCrawlContract.parsePayload(payload, 'leaderboard')

    expect(() => parse({ region: 'EU', intervalMs: 10_800_000 })).not.toThrow()
    expect(() => parse({ mode: 'solo2v2', region: 'EU', intervalMs: 10_800_000 })).not.toThrow()

    expect(() => parse({ region: 'all', intervalMs: 10_800_000 })).toThrow()
    expect(() => parse({ region: 'EU', intervalMs: 60_000 })).toThrow()
    expect(() => parse({ region: 'EU', intervalMs: 10_800_000, page: 3 })).toThrow()
    expect(() => parse({ mode: '3v3', region: 'EU', intervalMs: 10_800_000 })).toThrow()
    expect(() => parse({ mode: null, region: 'EU', intervalMs: 10_800_000 })).toThrow()
  })

  test('saves and replaces crawl progress per region', async () => {
    const progress = createLeaderboardDeepCrawlProgress(database)

    expect(await progress.read('1v1', 'EU')).toBeNull()
    const windowAt = new Date('2026-10-07T16:00:00.000Z')

    await progress.save({
      mode: '1v1',
      region: 'EU',
      windowAt,
      nextPage: 41,
      totalPages: 1630,
    })

    await progress.save({
      mode: '1v1',
      region: 'EU',
      windowAt,
      nextPage: 141,
      totalPages: 1630,
    })

    await progress.save({
      mode: '2v2',
      region: 'EU',
      windowAt,
      nextPage: 7,
      totalPages: 900,
    })

    expect(await progress.read('2v2', 'EU')).toMatchObject({ nextPage: 7 })
    expect(await progress.read('solo2v2', 'EU')).toBeNull()

    expect(await progress.read('1v1', 'EU')).toEqual({
      windowAt,
      nextPage: 141,
      totalPages: 1630,
    })
  })
})
