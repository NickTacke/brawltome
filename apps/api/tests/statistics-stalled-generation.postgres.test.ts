import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import {
  type CohortCandidateSnapshot,
  createPostgresStatistics,
  launchCohortRegions,
  statisticsModule,
} from '@brawltome/statistics'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'statistics_stalled_generation',
    modules: [queueModule, statisticsModule],
  })
})

afterAll(async () => {
  await database?.drop()
}, 30_000)

function snapshots(generation: number): CohortCandidateSnapshot[] {
  return launchCohortRegions.map((region, regionIndex) => {
    const base = generation * 10_000_000 + regionIndex * 100_000

    return {
      snapshotId: `00000000-0000-4000-8000-${String(generation * 100 + regionIndex + 1).padStart(12, '0')}`,
      generationId: `10000000-0000-4000-8000-${String(generation).padStart(12, '0')}`,
      observedAt: '2026-11-09T00:00:00.000Z',
      region,
      mode: '1v1',
      candidates: Array.from({ length: 125 }, (_, index) => ({ brawlhallaId: base + index + 1, rating: 2000 })),
    }
  })
}

describe('a Statistics generation that never reaches its publication decisions', () => {
  test('blocks new generations for its observation window and no longer', async () => {
    const dayMs = 24 * 60 * 60 * 1_000
    const startedAt = Date.parse('2026-11-09T00:00:00.000Z')
    const atDay = (day: number) => createPostgresStatistics(database, { now: () => new Date(startedAt + day * dayMs) })

    const stalled = await atDay(0).reconcileLaunchCohort(snapshots(1))

    expect(stalled.state).toBe('ready')

    expect((await atDay(6.5).reconciliationState()).launch?.isNextGenerationDue).toBe(false)
    expect(await atDay(6.5).reconcileLaunchCohort(snapshots(2))).toMatchObject({ generationId: stalled.generationId })

    expect((await atDay(7).reconciliationState()).launch?.isNextGenerationDue).toBe(true)

    const replacement = await atDay(7).reconcileLaunchCohort(snapshots(2))

    expect(replacement.generationId).not.toBe(stalled.generationId)

    // the replacement holds its own window, so a stall repeats at most once a week
    expect((await atDay(13).reconciliationState()).launch?.isNextGenerationDue).toBe(false)
    expect(await atDay(13).reconcileLaunchCohort(snapshots(3))).toMatchObject({
      generationId: replacement.generationId,
    })
  })
})
