import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import { createPostgresStatistics, createStatisticsReservations, statisticsModule } from '@brawltome/statistics'
import postgres from 'postgres'
import { MAX_QUEUED_STATISTICS_COLLECTIONS, reconcileStatisticsCohort } from '../src/statistics-cohort-reconciliation'
import { STATISTICS_COLLECTION_SPACING_MS } from '../src/statistics-collection-source'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'statistics_collection_backlog',
    modules: [queueModule, statisticsModule],
  })
})

afterAll(async () => {
  await database?.drop()
}, 30_000)

const noLeaderboard = {
  getLeaderboard: async (input: { mode: '1v1'; page: number; pageSize?: number }) => ({
    status: 'unavailable' as const,
    reason: 'not_yet_published' as const,
    mode: input.mode,
    page: input.page,
    pageSize: input.pageSize ?? 50,
  }),
}

describe('Statistics collection backlog', () => {
  test('keeps the queue to a few minutes of work and refills it as work finishes', async () => {
    const statistics = createPostgresStatistics(database)
    const reservations = createStatisticsReservations(database)
    const sql = postgres(database.connectionString, { max: 1 })

    await statistics.reconcileCohort({
      snapshotId: '00000000-0000-4000-8000-000000000001',
      generationId: '10000000-0000-4000-8000-000000000001',
      observedAt: '2026-08-10T00:00:00.000Z',
      region: 'EU',
      mode: '1v1',
      candidates: Array.from({ length: 40 }, (_, index) => ({ brawlhallaId: index + 1, rating: 2000 })),
    })

    const tick = () => reconcileStatisticsCohort(statistics, reservations, noLeaderboard as never)

    try {
      await tick()
      await tick()

      expect(await reservations.countQueuedStatisticsCollections()).toBe(MAX_QUEUED_STATISTICS_COLLECTIONS)

      const queuedMinutes = (MAX_QUEUED_STATISTICS_COLLECTIONS * STATISTICS_COLLECTION_SPACING_MS) / 60_000

      expect(queuedMinutes).toBeLessThan(15)

      await sql`
        UPDATE queue.operations SET status = 'succeeded', completed_at = clock_timestamp()
        WHERE id IN (
          SELECT id FROM queue.operations
          WHERE kind LIKE 'statistics-%-collection' AND status = 'pending'
          ORDER BY created_at, id LIMIT 5
        )
      `

      await tick()

      expect(await reservations.countQueuedStatisticsCollections()).toBe(MAX_QUEUED_STATISTICS_COLLECTIONS)
    } finally {
      await sql.end()
    }
  })
})
