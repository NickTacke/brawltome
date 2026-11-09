import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import {
  type CohortCandidateSnapshot,
  createPostgresStatistics,
  type LaunchCohortRegion,
  launchCohortRegions,
  statisticsModule,
} from '@brawltome/statistics'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'statistics_partial_cohort',
    modules: [queueModule, statisticsModule],
  })
})

afterAll(async () => {
  await database?.drop()
}, 30_000)

function snapshots(generation: number, thinRegion: LaunchCohortRegion | null): CohortCandidateSnapshot[] {
  return launchCohortRegions.map((region, regionIndex) => {
    const base = generation * 10_000_000 + regionIndex * 100_000
    const platinumPlayers = region === thinRegion ? 1 : 125

    return {
      snapshotId: `00000000-0000-4000-8000-${String(generation * 100 + regionIndex + 1).padStart(12, '0')}`,
      generationId: `10000000-0000-4000-8000-${String(generation).padStart(12, '0')}`,
      observedAt: '2026-11-09T00:00:00.000Z',
      region,
      mode: '1v1',
      candidates: [
        ...Array.from({ length: platinumPlayers }, (_, index) => ({ brawlhallaId: base + index + 1, rating: 1680 })),
        ...Array.from({ length: 125 }, (_, index) => ({ brawlhallaId: base + 500 + index + 1, rating: 2000 })),
      ],
    }
  })
}

describe('Statistics launch cohort with a left-out cell', () => {
  test('keeps the thin cell on record and collects only the covered cells', async () => {
    const statistics = createPostgresStatistics(database)
    const generation = await statistics.reconcileLaunchCohort(snapshots(1, 'EU'))

    expect(generation.state).toBe('ready')
    expect(generation.cells).toHaveLength(18)
    expect(generation.selectedPlayers).toBe(17 * 125)

    const thinCell = generation.cells.find(({ region, bracket }) => region === 'EU' && bracket === 'Platinum')

    expect(thinCell).toMatchObject({
      state: 'insufficient-evidence',
      eligiblePlayers: 1,
      selectedPlayers: 0,
      members: [],
    })

    const intents = await statistics.collectionIntents()

    expect(intents.length).toBeGreaterThan(0)
    expect(intents.some(({ cohortId }) => cohortId === thinCell?.cohortId)).toBe(false)
  })
})
