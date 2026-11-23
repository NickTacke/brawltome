import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPlayerRefreshReservations,
  createRankedCoverageRefreshes,
  interactivePlayerRefreshContract,
  playerModule,
} from '@brawltome/player'
import { createPostgresRefreshOperations, queueModule } from '@brawltome/queue'
import type { ActorAdmission } from '@brawltome/request-admission'
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

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'visitor_player_refresh', modules: [queueModule, playerModule] })
}, 30_000)

afterAll(async () => {
  await database?.drop()
})

function visitorRefresh(brawlhallaId: number, staleSections: ('ranked' | 'stats')[]) {
  return requestInteractivePlayerRefresh({
    brawlhallaId,
    dedupeKey: `player:${brawlhallaId}:visit:${staleSections.join(',')}`,
    staleSections,
    provenance: { source: 'interactive-api' },
    playerRefreshReservations: createPlayerRefreshReservations(database),
    requestAdmission: admittingActors,
    resolveActor: () => ({ kind: 'verified-anonymous', ip: '203.0.113.7' }),
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

describe('a visitor refresh beside a ranked coverage refresh', () => {
  test('takes over a queued coverage refresh and widens it to the sections the visitor needs', async () => {
    const coverageId = await queueCoverage(1001)

    const outcome = await visitorRefresh(1001, ['ranked', 'stats'])

    expect(outcome).toEqual({
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

  test('asks the visitor to come back when a running coverage refresh misses one of their sections', async () => {
    const coverageId = await queueCoverage(1002)

    // settle the other tests' work so the claim reaches this coverage refresh
    await database.sql`
      UPDATE queue.operations SET status = 'succeeded', completed_at = clock_timestamp() WHERE id <> ${coverageId}
    `

    const operations = createPostgresRefreshOperations({ database }, { jobs: [interactivePlayerRefreshContract] })
    const lease = await operations.claim('worker', 30_000, admission)

    expect(lease?.operationId).toBe(coverageId)

    expect(await visitorRefresh(1002, ['ranked', 'stats'])).toEqual({
      outcome: 'temporarilyUnavailable',
      retry: { kind: 'after', afterSeconds: 2 },
    })

    // ranked alone is what the running refresh fetches, so that visitor can wait on it
    expect(await visitorRefresh(1002, ['ranked'])).toMatchObject({
      outcome: 'alreadyRefreshing',
      operationId: coverageId,
    })

    expect(await readOperation(coverageId)).toMatchObject({ work_class: 'primary-monitoring', status: 'leased' })
  })

  test('reserves the visitor their own refresh when nothing holds the player', async () => {
    const outcome = await visitorRefresh(1003, ['ranked', 'stats'])

    if (outcome.outcome !== 'accepted') throw new Error(`expected an accepted refresh, got ${outcome.outcome}`)

    expect(await readOperation(outcome.operationId)).toMatchObject({
      work_class: 'interactive',
      payload: { brawlhallaId: 1003, staleSections: ['ranked', 'stats'] },
    })
  })
})
