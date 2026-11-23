import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPlayerRefreshReservations,
  createRankedCoverageRefreshes,
  interactivePlayerRefreshContract,
  playerModule,
} from '@brawltome/player'
import { createPostgresRefreshOperations, queueModule } from '@brawltome/queue'
import type { ActorAdmission, ActorAdmissionResult } from '@brawltome/request-admission'
import { requestInteractivePlayerRefresh } from '../src/interactive-player-refresh'

const admission = {
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
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
} as const

const admittingActors: ActorAdmission = {
  admitActor: async () => ({ outcome: 'admitted' }),
  admitActorOnce: async () => ({ outcome: 'admitted' }),
  hasActorReservation: async () => false,
}

const verificationRequired = { outcome: 'verificationRequired', retry: { kind: 'verify' } } as const
const askAgainShortly = { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 2 } } as const

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'visitor_player_refresh', modules: [queueModule, playerModule] })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

type VisitorOptions = {
  staleSections?: ('ranked' | 'stats')[]
  resolveActor?: Parameters<typeof requestInteractivePlayerRefresh>[0]['resolveActor']
  admission?: ActorAdmissionResult
  // the reservations the request sees, to stage a refresh that appears after its first look
  reservations?: ReturnType<typeof createPlayerRefreshReservations>
}

function visitorRefresh(brawlhallaId: number, options: VisitorOptions = {}) {
  const staleSections = options.staleSections ?? ['ranked', 'stats']
  const actorAdmission = options.admission ?? { outcome: 'admitted' }

  return requestInteractivePlayerRefresh({
    brawlhallaId,
    dedupeKey: `player:${brawlhallaId}:visit:${staleSections.join(',')}`,
    staleSections,
    provenance: { source: 'interactive-api' },
    playerRefreshReservations: options.reservations ?? createPlayerRefreshReservations(database),
    requestAdmission: { ...admittingActors, admitActor: async () => actorAdmission },
    resolveActor: options.resolveActor ?? (() => ({ kind: 'verified-anonymous', ip: '203.0.113.7' })),
  })
}

async function readOperation(operationId: string) {
  const [row] = await database.sql<{ work_class: string; status: string; payload: unknown }[]>`
    SELECT work_class, status, payload FROM queue.operations WHERE id = ${operationId}
  `

  return row
}

async function queueCoverage(brawlhallaId: number): Promise<string> {
  expect(await createRankedCoverageRefreshes(database).enqueueRankedCoverageRefresh(brawlhallaId)).toBe(true)

  const [row] = await database.sql<{ id: string }[]>`
    SELECT id FROM queue.operations
    WHERE provenance->>'source' = 'ranked-coverage' AND payload->>'brawlhallaId' = ${String(brawlhallaId)}
  `

  return row.id
}

// a worker claims the operation; the other tests' work is settled first so the claim reaches it
async function startOnWorker(operationId: string): Promise<void> {
  await database.sql`
    UPDATE queue.operations
    SET status = 'succeeded', completed_at = clock_timestamp(), lease_owner = NULL, lease_expires_at = NULL,
        reservation_token = NULL, reservation_expires_at = NULL
    WHERE id <> ${operationId} AND status IN ('pending', 'awaiting_admission', 'leased')
  `

  const operations = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract] })
  const lease = await operations.claim('worker', 30_000, admission)

  expect(lease?.operationId).toBe(operationId)
}

describe('a visitor refresh beside a ranked coverage refresh', () => {
  test('takes over a queued coverage refresh and widens it to their sections', async () => {
    const coverageId = await queueCoverage(1001)

    expect(await visitorRefresh(1001)).toEqual({
      outcome: 'alreadyRefreshing',
      operationId: coverageId,
      retry: { kind: 'poll', afterSeconds: 2 },
    })

    expect(await readOperation(coverageId)).toEqual({
      work_class: 'interactive',
      status: 'pending',
      payload: { cohort: 'ranked-coverage', brawlhallaId: 1001, staleSections: ['ranked', 'stats'] },
    })
  })

  test('leaves a queued coverage refresh alone for a request that fails verification', async () => {
    const coverageId = await queueCoverage(1004)

    expect(await visitorRefresh(1004, { resolveActor: () => verificationRequired })).toEqual(verificationRequired)

    expect(await readOperation(coverageId)).toMatchObject({
      work_class: 'primary-monitoring',
      payload: { cohort: 'ranked-coverage', staleSections: ['ranked'] },
    })
  })

  test('leaves a queued coverage refresh alone for a rate-limited request', async () => {
    const coverageId = await queueCoverage(1005)
    const limited = { outcome: 'rate-limited', retryAfterSeconds: 40 } as const

    expect(await visitorRefresh(1005, { admission: limited })).toEqual({
      outcome: 'rateLimited',
      retry: { kind: 'after', afterSeconds: 40 },
    })

    expect(await readOperation(coverageId)).toMatchObject({
      work_class: 'primary-monitoring',
      payload: { cohort: 'ranked-coverage', staleSections: ['ranked'] },
    })
  })

  test('widens a queued ranked-only visitor refresh for a later visitor who needs stats too', async () => {
    const coverageId = await queueCoverage(1006)

    // the overlay asks for ranked alone and takes the coverage refresh over as it is
    expect(await visitorRefresh(1006, { staleSections: ['ranked'] })).toMatchObject({ operationId: coverageId })

    expect(await readOperation(coverageId)).toMatchObject({
      work_class: 'interactive',
      payload: { staleSections: ['ranked'] },
    })

    expect(await visitorRefresh(1006)).toMatchObject({ outcome: 'alreadyRefreshing', operationId: coverageId })
    expect(await readOperation(coverageId)).toMatchObject({ payload: { staleSections: ['ranked', 'stats'] } })
  })

  test('asks the visitor to come back when a running refresh misses one of their sections', async () => {
    const coverageId = await queueCoverage(1002)

    await startOnWorker(coverageId)

    expect(await visitorRefresh(1002)).toEqual(askAgainShortly)

    // ranked alone is what the running refresh fetches, so that visitor can wait on it
    expect(await visitorRefresh(1002, { staleSections: ['ranked'] })).toMatchObject({
      outcome: 'alreadyRefreshing',
      operationId: coverageId,
    })

    expect(await readOperation(coverageId)).toMatchObject({ work_class: 'primary-monitoring', status: 'leased' })
  })

  test('checks the sections of a refresh that started after its first look', async () => {
    const coverageId = await queueCoverage(1007)

    await startOnWorker(coverageId)

    // the first look found nothing; the reservation then meets the running coverage refresh
    const reservations = createPlayerRefreshReservations(database)
    const lateReservations = { ...reservations, findActiveInteractivePlayerRefresh: async () => null }

    expect(await visitorRefresh(1007, { reservations: lateReservations })).toEqual(askAgainShortly)
  })

  test('reserves the visitor their own refresh when nothing holds the player', async () => {
    const outcome = await visitorRefresh(1003)

    if (outcome.outcome !== 'accepted') throw new Error(`expected an accepted refresh, got ${outcome.outcome}`)

    expect(await readOperation(outcome.operationId)).toMatchObject({
      work_class: 'interactive',
      payload: { brawlhallaId: 1003, staleSections: ['ranked', 'stats'] },
    })
  })
})
