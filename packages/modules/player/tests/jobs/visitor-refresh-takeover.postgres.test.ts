import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations, queueModule } from '@brawltome/queue'
import { interactivePlayerRefreshContract, playerModule } from '../../index'
import { enqueueRankedCoverageRefresh } from '../../jobs/ranked-coverage-refreshes'
import { inspectVisitorFit, takeOverPlayerRefresh } from '../../jobs/visitor-refresh-takeover'

const admission = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
} as const

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'visitor_refresh_takeover', modules: [queueModule, playerModule] })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

async function readCoverage(brawlhallaId: number) {
  const [row] = await database.sql<{ id: string; work_class: string; status: string; payload: unknown }[]>`
    SELECT id, work_class, status, payload FROM queue.operations
    WHERE provenance->>'source' = 'ranked-coverage' AND payload->>'brawlhallaId' = ${String(brawlhallaId)}
  `

  return row
}

describe('visitor refresh takeover', () => {
  test('finds nothing to take over when no refresh holds the player', async () => {
    expect(await inspectVisitorFit(database, { brawlhallaId: 500, staleSections: ['ranked'] })).toBeNull()

    expect(await takeOverPlayerRefresh(database, { brawlhallaId: 500, staleSections: ['ranked'] })).toEqual({
      outcome: 'none',
    })
  })

  test('makes a queued coverage refresh the visitor own, with both sections and no cohort', async () => {
    expect(await enqueueRankedCoverageRefresh(database, 501)).toBe(true)
    expect(await inspectVisitorFit(database, { brawlhallaId: 501, staleSections: ['stats'] })).toBe('take-over')

    const queued = await readCoverage(501)
    const takeover = await takeOverPlayerRefresh(database, { brawlhallaId: 501, staleSections: ['stats'] })

    expect(takeover).toEqual({ outcome: 'attached', operationId: queued.id })

    expect(await readCoverage(501)).toMatchObject({
      work_class: 'interactive',
      status: 'pending',
      payload: { brawlhallaId: 501, staleSections: ['ranked', 'stats'] },
    })
  })

  test('leaves a running coverage refresh alone and tells the visitor it is running', async () => {
    expect(await enqueueRankedCoverageRefresh(database, 502)).toBe(true)

    const operations = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract] })
    let lease = await operations.claim('worker', 30_000, admission)

    // the earlier test's refresh may come first
    while (lease && lease.payload && (lease.payload as { brawlhallaId: number }).brawlhallaId !== 502) {
      lease = await operations.claim('worker', 30_000, admission)
    }

    expect(await takeOverPlayerRefresh(database, { brawlhallaId: 502, staleSections: ['ranked', 'stats'] })).toEqual({
      outcome: 'running',
    })

    expect(await readCoverage(502)).toMatchObject({
      work_class: 'primary-monitoring',
      status: 'leased',
      payload: { cohort: 'ranked-coverage', staleSections: ['ranked'] },
    })
  })
})
