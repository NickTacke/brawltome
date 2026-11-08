import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createPostgresRefreshOperations,
  type OperationLease,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import { createStatisticsReservations } from '../../jobs/statistics-reservations'

let database: TestDatabase

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
    'primary-monitoring': 5,
    leaderboard: 4,
    'global-statistics': 3,
    projection: 2,
    maintenance: 1,
  },
}

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')

  return lease
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'statistics_dead_letters', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

async function createCollectionDeadLetter() {
  const operations = createPostgresRefreshOperations({ database }, { effectStates: {} })
  const reservations = createStatisticsReservations(database)
  const cohortId = randomUUID()
  const operationKey = `statistics:${cohortId}:42:ranked`

  const reserved = await reservations.reserveStatisticsCollection({
    kind: 'statistics-ranked-collection',
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics',
    payload: { cohortId, brawlhallaId: 42 },
    provenance: { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' },
    maxAttempts: 1,
  })

  expect(await operations.claim('premature-statistics-worker', 10_000, admission)).toBeNull()
  expect(await reservations.activateStatisticsCollection(reserved.operationId)).toBe('transitioned')

  const original = requireLease(
    await operations.claim('statistics-original', 10_000, admission, 'statistics-ranked-collection'),
  )

  const [effect] = await database.sql<{ result: string }[]>`
    SELECT refresh_operations.record_statistics_collection_effect(
      ${original.operationId}, ${original.operationKey}, ${original.kind},
      ${original.leaseOwner}, ${original.leaseToken}
    ) AS result
  `

  expect(effect.result).toBe('applied')
  await operations.fail(original, { code: 'source_failed', message: 'repairable', retryable: false }, 0)

  return { operations, original, operationKey }
}

describe('statistics dead letters', () => {
  test('replays a reserved Statistics collection with stable effect identity', async () => {
    const { operations, original, operationKey } = await createCollectionDeadLetter()

    expect((await operations.inspectDeadLetter(original.operationId))?.statisticsEffects).toEqual([
      expect.objectContaining({ operationKey, kind: 'statistics-ranked-collection' }),
    ])

    const replayed = await operations.replayDeadLetter({
      operationId: original.operationId,
      actorId: 'operator:statistics',
      reason: 'Statistics source repaired',
    })

    if (replayed.outcome !== 'replayed') throw new Error('Expected Statistics replay')

    const successor = requireLease(
      await operations.claim('statistics-replay', 10_000, admission, 'statistics-ranked-collection'),
    )

    expect(successor).toMatchObject({
      operationId: replayed.replayOperationId,
      effectOperationId: original.effectOperationId,
      operationKey,
      kind: 'statistics-ranked-collection',
      payload: original.payload,
      attemptNumber: 1,
    })
  })
})
