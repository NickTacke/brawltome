import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BhApiHttpError } from '@brawltome/bhapi'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type AdmissionConfig, queueModule } from '@brawltome/queue'
import { createPostgresStatistics, createStatisticsReservations, statisticsModule } from '@brawltome/statistics'
import postgres from 'postgres'
import { reconcileStatisticsCohort } from '../src/statistics-cohort-reconciliation'
import { collectStatisticsEvidence } from '../src/statistics-collection-source'
import { createStatisticsTestJobs, createTestQueue, runOneWithJobs } from './fixtures/queue'

const admission: AdmissionConfig = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
}

const rankedEvidence = (id: number) => ({
  brawlhalla_id: id,
  name: 'Tracer',
  games: 20,
  wins: 12,
  rating: 2100,
  peak_rating: 2200,
  region: 'EU',
  region_ranks: [],
  legends: [{ legend_id: 3, games: 10, wins: 6, rating: 2050, peak_rating: 2150, tier: 'Diamond' }],
})

const serviceUnavailable = () => new BhApiHttpError('Brawlhalla API error: 503', 503, 'brawlhalla-v1')

let database: TestDatabase
let sql: ReturnType<typeof postgres>

beforeEach(async () => {
  database = await createTestDatabase({
    label: 'statistics_collection_retry',
    modules: [queueModule, statisticsModule],
  })

  sql = postgres(database.connectionString, { max: 1 })
})

afterEach(async () => {
  await sql.end()
  await database.drop()
}, 30_000)

// one player, so the ranked collection is the only operation whose source calls are scripted to fail
async function startCollection(rankedFailures: number) {
  const statistics = createPostgresStatistics(database)
  const operations = createTestQueue({ database })
  const pausedSources: string[] = []
  const rankedCalls: number[] = []

  const sourceAdmission = {
    admitSource: async () => ({ outcome: 'admitted' as const }),
    pauseSource: async (domain: string) => {
      pausedSources.push(domain)
    },
  }

  const source = {
    async getPlayerStatsV1Payload(id: number, mode: 'ranked_1v1' | 'all') {
      if (mode === 'all') throw new Error('this test only runs the ranked collection')

      rankedCalls.push(id)
      if (rankedCalls.length <= rankedFailures) throw serviceUnavailable()

      return rankedEvidence(id)
    },
  }

  await statistics.reconcileCohort({
    snapshotId: '00000000-0000-4000-8000-000000000001',
    generationId: '10000000-0000-4000-8000-000000000001',
    observedAt: '2026-08-10T00:00:00.000Z',
    region: 'EU',
    mode: '1v1',
    candidates: [{ brawlhallaId: 42, rating: 2000 }],
  })

  await reconcileStatisticsCohort(statistics, createStatisticsReservations(database), {
    getLeaderboard: async (input) => ({
      status: 'unavailable',
      reason: 'not_yet_published',
      mode: input.mode,
      page: input.page,
      pageSize: input.pageSize ?? 50,
    }),
  })

  // the lifetime collection is out of the way, so every claim below is the ranked one
  await sql`
    UPDATE queue.operations SET status = 'succeeded', completed_at = clock_timestamp()
    WHERE kind = 'statistics-lifetime-collection'
  `

  const runOne = () =>
    runOneWithJobs(operations, 'worker', {
      leaseMs: 5_000,
      retryDelayMs: 0,
      admission,
      sourceAdmission,
      jobs: createStatisticsTestJobs(statistics, {
        sourceAdmission,
        collectEvidence: (lease) => collectStatisticsEvidence(source, lease),
      }),
    })

  const readOperation = async () => {
    const [operation] = await sql<
      {
        status: string
        attempt_count: number
        wait_ms: number
        error_code: string | null
      }[]
    >`
      SELECT status, attempt_count, last_error ->> 'code' AS error_code,
             (extract(epoch FROM available_at - clock_timestamp()) * 1000)::integer AS wait_ms
      FROM queue.operations WHERE kind = 'statistics-ranked-collection'
    `

    return operation
  }

  const makeOperationDue = () => sql`
    UPDATE queue.operations SET available_at = clock_timestamp()
    WHERE kind = 'statistics-ranked-collection' AND status = 'pending'
  `

  const readAttemptNumbers = async () => {
    const rows = await sql<{ attempt_number: number }[]>`
      SELECT attempt_number FROM statistics.collection_attempts ORDER BY attempt_number
    `

    return rows.map(({ attempt_number }) => attempt_number)
  }

  return { runOne, readOperation, makeOperationDue, readAttemptNumbers, rankedCalls, pausedSources, statistics }
}

describe('Statistics collection after an upstream 5xx', () => {
  test('a 503 retries the player and the next call succeeds without a dead letter', async () => {
    const collection = await startCollection(1)

    expect(await collection.runOne()).toBe(true)

    const waiting = await collection.readOperation()

    expect(waiting).toMatchObject({ status: 'pending', attempt_count: 1, error_code: 'source_unavailable' })
    expect(waiting.wait_ms).toBeGreaterThan(0)
    expect(collection.pausedSources).toEqual(['brawlhalla-v1'])

    await collection.makeOperationDue()
    expect(await collection.runOne()).toBe(true)

    expect(await collection.readOperation()).toMatchObject({ status: 'succeeded', attempt_count: 2 })
    expect(collection.rankedCalls).toEqual([42, 42])
    expect(await collection.readAttemptNumbers()).toEqual([1, 2])

    const audit = await collection.statistics.getCohort()

    expect(audit?.members[0]).toMatchObject({ brawlhallaId: 42, rankedSucceededAt: expect.any(String) })
  })

  test('a player that keeps failing stops after three source calls with one dead letter', async () => {
    const collection = await startCollection(10)

    for (let run = 0; run < 3; run++) {
      expect(await collection.runOne()).toBe(true)
      await collection.makeOperationDue()
    }

    expect(await collection.readOperation()).toMatchObject({
      status: 'dead_letter',
      attempt_count: 3,
      error_code: 'source_unavailable',
    })

    expect(await collection.runOne()).toBe(false)
    expect(collection.rankedCalls).toEqual([42, 42, 42])
    expect(await collection.readAttemptNumbers()).toEqual([1, 2, 3])
  })

  test('each failed call waits longer, so a short outage cannot use up one player', async () => {
    const collection = await startCollection(10)

    await collection.runOne()
    const first = await collection.readOperation()

    await collection.makeOperationDue()
    await collection.runOne()
    const second = await collection.readOperation()

    expect(first.wait_ms).toBeGreaterThan(4 * 60_000)
    expect(second.wait_ms).toBeGreaterThan(25 * 60_000)
  })
})
