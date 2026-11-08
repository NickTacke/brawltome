import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type DeadLetterOperations,
  type OperationLease,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import { statisticsDeadLetterHooks } from '../../jobs/dead-letter-hooks'
import { createStatisticsReservations } from '../../jobs/statistics-reservations'

let database: TestDatabase
let deadLetters: DeadLetterOperations

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
  deadLetters = createPostgresDeadLetterOperations(database, statisticsDeadLetterHooks)
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

async function sealCollection(collectionOperationId: string): Promise<void> {
  const reservations = createStatisticsReservations(database)
  const operationKey = `statistics:${randomUUID()}:publication`

  const publication = await reservations.reserveStatisticsPublication({
    kind: 'statistics-publication',
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics',
    payload: { generationId: randomUUID(), product: 'ranked' },
    provenance: { source: 'statistics-publication-validation', requestedBy: 'issue-210' },
  })

  await database.sql`
    INSERT INTO refresh_operations.statistics_collection_seals (collection_operation_id, publication_operation_id)
    VALUES (${collectionOperationId}, ${publication.operationId})
  `
}

describe('statistics dead letters', () => {
  test('replays a reserved Statistics collection with stable effect identity', async () => {
    const { operations, original, operationKey } = await createCollectionDeadLetter()

    expect((await deadLetters.inspectDeadLetter(original.operationId))?.statisticsEffects).toEqual([
      expect.objectContaining({ operationKey, kind: 'statistics-ranked-collection' }),
    ])

    const replayed = await deadLetters.replayDeadLetter({
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

    await operations.complete(successor)
  })

  test("a sealed statistics collection can't be replayed", async () => {
    const { original } = await createCollectionDeadLetter()

    await sealCollection(original.effectOperationId)

    await expect(
      deadLetters.replayDeadLetter({
        operationId: original.operationId,
        actorId: 'operator:statistics',
        reason: 'must not race publication validation',
      }),
    ).rejects.toThrow('Statistics collection replay is sealed by publication validation')

    expect((await deadLetters.inspectDeadLetter(original.operationId))?.auditActions).toEqual([])
  })

  test('a sealed statistics collection cannot be discarded either', async () => {
    const { original } = await createCollectionDeadLetter()

    await sealCollection(original.effectOperationId)

    await expect(
      deadLetters.discardDeadLetter({
        operationId: original.operationId,
        actorId: 'operator:statistics',
        reason: 'must stay evidence for publication',
      }),
    ).rejects.toThrow('sealed by publication validation')
  })

  test('lists both publication tables for the publication kinds', async () => {
    const operations = createPostgresRefreshOperations({ database }, { effectStates: {} })
    const reservations = createStatisticsReservations(database)
    const operationKey = `statistics:${randomUUID()}:legend-meta`

    const reserved = await reservations.reserveStatisticsLegendMetaPublication({
      kind: 'statistics-legend-meta-publication',
      dedupeKey: operationKey,
      operationKey,
      workClass: 'global-statistics',
      payload: { generationId: randomUUID() },
      provenance: { source: 'statistics-legend-meta-publication', requestedBy: 'issue-211' },
      maxAttempts: 1,
    })

    await reservations.activateStatisticsLegendMetaPublication(reserved.operationId)

    const lease = requireLease(
      await operations.claim('statistics-legend-meta', 10_000, admission, 'statistics-legend-meta-publication'),
    )

    await database.sql`
      INSERT INTO refresh_operations.statistics_legend_meta_publication_effects
        (operation_key, operation_id, lease_token)
      VALUES (${lease.operationKey}, ${lease.effectOperationId}, ${lease.leaseToken})
    `

    await operations.fail(lease, { code: 'source_failed', message: 'repairable', retryable: false }, 0)

    const inspected = await deadLetters.inspectDeadLetter(lease.operationId)

    expect(inspected?.statisticsPublicationEffects).toEqual([
      { operationKey, leaseToken: lease.leaseToken, createdAt: expect.any(String) },
    ])

    expect(inspected?.statisticsEffects).toEqual([])
  })
})
