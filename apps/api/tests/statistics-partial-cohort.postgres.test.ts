import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type AdmissionConfig, queueModule } from '@brawltome/queue'
import {
  type CohortCandidateSnapshot,
  createPostgresStatistics,
  createStatisticsReservations,
  type LaunchCohortRegion,
  launchCohortRegions,
  statisticsModule,
} from '@brawltome/statistics'
import { reconcileStatisticsCohort } from '../src/statistics-cohort-reconciliation'
import { createStatisticsTestJobs, createTestQueue, runOneWithJobs } from './fixtures/queue'
import { seedTerminalProduct } from './fixtures/statistics-cohort'

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

describe('Statistics publication with a left-out cell', () => {
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

  const noLeaderboard = {
    getLeaderboard: async (input: { mode: string; page: number; pageSize?: number }) => ({
      status: 'unavailable' as const,
      reason: 'not_yet_published' as const,
      mode: input.mode,
      page: input.page,
      pageSize: input.pageSize ?? 50,
    }),
  } as never

  let publicationDatabase: TestDatabase

  beforeAll(async () => {
    publicationDatabase = await createTestDatabase({
      label: 'statistics_partial_publication',
      modules: [queueModule, statisticsModule],
    })
  })

  afterAll(async () => {
    await publicationDatabase?.drop()
  }, 30_000)

  test('publishes around the thin cell and labels what each view leaves out', async () => {
    const statistics = createPostgresStatistics(publicationDatabase)
    const reservations = createStatisticsReservations(publicationDatabase)
    const operations = createTestQueue({ database: publicationDatabase })
    const connectionString = publicationDatabase.connectionString

    const generation = await statistics.reconcileLaunchCohort(snapshots(1, 'EU'))

    await seedTerminalProduct(connectionString, generation, 'ranked', 120)
    await seedTerminalProduct(connectionString, generation, 'lifetime', 120)

    const tick = () => reconcileStatisticsCohort(statistics, reservations, noLeaderboard)

    const runDueJobs = async () => {
      const jobs = createStatisticsTestJobs(statistics)
      const options = { leaseMs: 5_000, retryDelayMs: 0, admission, jobs }

      while (await runOneWithJobs(operations, 'publication-worker', options)) {}
    }

    await tick()
    await runDueJobs()
    await tick()
    await runDueJobs()

    const ranked = await statistics.getPublication('ranked')

    expect(ranked?.latestDecision).toMatchObject({ outcome: 'accepted', reasons: [] })

    const pooled = await statistics.getLegendMeta({ region: 'all', bracket: 'all' })

    if (pooled.status === 'unavailable') throw new Error('Legend Meta was not published')

    expect(pooled.cohortCells.filter(({ status }) => status === 'left-out')).toEqual([
      { region: 'EU', bracket: 'Platinum', status: 'left-out', eligiblePlayers: 1, selectedPlayers: 0 },
    ])

    expect(pooled.slice).toMatchObject({
      selectedPlayers: 17 * 125,
      observedPlayers: 17 * 120,
      sliceCoverage: {
        filterCells: 18,
        coveredCells: 17,
        leftOutCells: [{ region: 'EU', bracket: 'Platinum' }],
        includesPlatinumBoardTop: true,
      },
    })

    const leftOutCell = await statistics.getLegendMeta({ region: 'EU', bracket: 'Platinum' })

    expect(leftOutCell).toMatchObject({
      status: 'fresh',
      slice: { selectedPlayers: 0, sliceCoverage: { coveredCells: 0, leftOutCells: [{ region: 'EU' }] } },
    })

    const diamondEverywhere = await statistics.getLegendMeta({ region: 'all', bracket: 'Diamond+' })

    expect(diamondEverywhere).toMatchObject({
      status: 'fresh',
      slice: { sliceCoverage: { filterCells: 9, coveredCells: 9, leftOutCells: [], includesPlatinumBoardTop: false } },
    })
  })
})
