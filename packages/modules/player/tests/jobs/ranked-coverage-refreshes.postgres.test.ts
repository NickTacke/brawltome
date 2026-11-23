import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations, queueModule } from '@brawltome/queue'
import { interactivePlayerRefreshContract, playerModule } from '../../index'
import { activeBackgroundPlayerRefreshes, activeInteractivePlayerRefreshes } from '../../jobs/active-player-refreshes'
import { enqueueRankedCoverageRefresh, recentRankedCoverageAttempts } from '../../jobs/ranked-coverage-refreshes'
import { enqueueRecentlyViewedRefreshes } from '../../jobs/recently-viewed-refreshes'

let database: TestDatabase

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
  database = await createTestDatabase({ label: 'ranked_coverage', modules: [queueModule, playerModule] })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

describe('ranked coverage operations', () => {
  test('enqueues a ranked-only background refresh once per player', async () => {
    const operations = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract] })

    expect(await enqueueRankedCoverageRefresh(database, 100)).toBe(true)
    expect(await enqueueRankedCoverageRefresh(database, 100)).toBe(false)

    const lease = await operations.claim('worker', 1_000, admission)

    expect(lease).toMatchObject({
      kind: 'interactive-player-refresh',
      workClass: 'primary-monitoring',
      payload: { cohort: 'ranked-coverage', brawlhallaId: 100, staleSections: ['ranked'] },
      provenance: { source: 'ranked-coverage' },
    })

    await expect(enqueueRankedCoverageRefresh(database, 0)).rejects.toThrow('player 0')
  })

  test('counts background refreshes of every cohort, apart from interactive ones', async () => {
    const backgroundBefore = await activeBackgroundPlayerRefreshes(database)
    const interactiveBefore = await activeInteractivePlayerRefreshes(database)

    expect(await enqueueRankedCoverageRefresh(database, 200)).toBe(true)
    expect(await enqueueRecentlyViewedRefreshes(database, [201])).toEqual([201])

    expect(await activeBackgroundPlayerRefreshes(database)).toBe(backgroundBefore + 2)
    expect(await activeInteractivePlayerRefreshes(database)).toBe(interactiveBefore)

    await database.sql`
      UPDATE queue.operations SET work_class = 'interactive'
      WHERE payload->>'brawlhallaId' = '200'
    `

    expect(await activeBackgroundPlayerRefreshes(database)).toBe(backgroundBefore + 1)
    expect(await activeInteractivePlayerRefreshes(database)).toBe(interactiveBefore + 1)
  })

  test('reads the planner attempts and dead letters of its own refreshes only', async () => {
    expect(await enqueueRankedCoverageRefresh(database, 300)).toBe(true)
    expect(await enqueueRecentlyViewedRefreshes(database, [301])).toEqual([301])

    await database.sql`
      UPDATE queue.operations SET status = 'dead_letter', completed_at = clock_timestamp()
      WHERE payload->>'brawlhallaId' IN ('300', '301')
    `

    const attempts = await recentRankedCoverageAttempts(database, { windowDays: 7 })

    expect(attempts.find(({ brawlhallaId }) => brawlhallaId === 300)).toEqual({
      brawlhallaId: 300,
      lastPlannedAt: expect.any(Date),
      lastFailedAt: expect.any(Date),
    })

    expect(attempts.find(({ brawlhallaId }) => brawlhallaId === 301)).toBeUndefined()
  })
})
