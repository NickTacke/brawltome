import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { refreshOperationsModule } from '@brawltome/queue'
import { createStatisticsReservations, type StatisticsReservations } from '../../jobs/statistics-reservations'

let database: TestDatabase
let reservations: StatisticsReservations

const provenance = { source: 'statistics-cohort-reconciliation', requestedBy: 'issue-209' }

beforeAll(async () => {
  database = await createTestDatabase({ label: 'statistics_reservations', modules: [refreshOperationsModule] })
  reservations = createStatisticsReservations(database)
})

afterAll(async () => {
  await database?.drop()
})

function collectionInput(
  overrides: Partial<Parameters<StatisticsReservations['reserveStatisticsCollection']>[0]> = {},
) {
  const operationKey = `statistics:${randomUUID()}:42:ranked`

  return {
    kind: 'statistics-ranked-collection' as const,
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics' as const,
    payload: { cohortId: randomUUID(), brawlhallaId: 42 },
    provenance,
    ...overrides,
  }
}

function publicationInput(
  overrides: Partial<Parameters<StatisticsReservations['reserveStatisticsPublication']>[0]> = {},
) {
  const operationKey = `statistics:${randomUUID()}:publication`

  return {
    kind: 'statistics-publication' as const,
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics' as const,
    payload: { generationId: randomUUID(), product: 'ranked' as const },
    provenance,
    ...overrides,
  }
}

function legendMetaInput(
  overrides: Partial<Parameters<StatisticsReservations['reserveStatisticsLegendMetaPublication']>[0]> = {},
) {
  const operationKey = `statistics:${randomUUID()}:legend-meta`

  return {
    kind: 'statistics-legend-meta-publication' as const,
    dedupeKey: operationKey,
    operationKey,
    workClass: 'global-statistics' as const,
    payload: { generationId: randomUUID() },
    provenance,
    ...overrides,
  }
}

async function readStatus(operationId: string): Promise<string> {
  const [row] = await database.sql<{ status: string }[]>`
    SELECT status FROM refresh_operations.operations WHERE id = ${operationId}
  `

  return row.status
}

describe('statistics reservations', () => {
  test('reserves each kind awaiting binding and activates it for that kind only', async () => {
    const collection = await reservations.reserveStatisticsCollection(collectionInput())
    const publication = await reservations.reserveStatisticsPublication(publicationInput())
    const legendMeta = await reservations.reserveStatisticsLegendMetaPublication(legendMetaInput())

    expect(await reservations.listAwaitingStatisticsCollections()).toContain(collection.operationId)
    expect(await reservations.listAwaitingStatisticsPublications()).toContain(publication.operationId)
    expect(await reservations.listAwaitingStatisticsLegendMetaPublications()).toContain(legendMeta.operationId)

    expect(await reservations.activateStatisticsPublication(collection.operationId)).toBe('lease-lost')
    expect(await readStatus(collection.operationId)).toBe('awaiting_binding')

    expect(await reservations.activateStatisticsCollection(collection.operationId)).toBe('transitioned')
    expect(await reservations.activateStatisticsPublication(publication.operationId)).toBe('transitioned')
    expect(await reservations.activateStatisticsLegendMetaPublication(legendMeta.operationId)).toBe('transitioned')
    expect(await readStatus(collection.operationId)).toBe('pending')
  })

  test('a second collection kind cannot take an operation key held by the first', async () => {
    const ranked = collectionInput()

    await reservations.reserveStatisticsCollection(ranked)

    await expect(
      reservations.reserveStatisticsCollection({ ...ranked, kind: 'statistics-lifetime-collection' }),
    ).rejects.toThrow('statistics collection operation key has a different definition')
  })

  test('a changed definition is refused with the message of its kind', async () => {
    const publication = publicationInput()
    const legendMeta = legendMetaInput()

    await reservations.reserveStatisticsPublication(publication)
    await reservations.reserveStatisticsLegendMetaPublication(legendMeta)

    await expect(reservations.reserveStatisticsPublication({ ...publication, maxAttempts: 9 })).rejects.toThrow(
      'statistics publication operation key has a different definition',
    )

    await expect(
      reservations.reserveStatisticsLegendMetaPublication({ ...legendMeta, maxAttempts: 9 }),
    ).rejects.toThrow('Statistics Legend Meta operation key has a different definition')
  })

  test('reserving the same definition again finds the first operation', async () => {
    const input = collectionInput()
    const first = await reservations.reserveStatisticsCollection(input)
    const repeated = await reservations.reserveStatisticsCollection(input)

    expect(first.outcome).toBe('accepted')
    expect(repeated).toEqual({ outcome: 'already-active', operationId: first.operationId })
  })

  test('rejects invalid input before touching the queue', async () => {
    await expect(
      reservations.reserveStatisticsCollection({ ...collectionInput(), dedupeKey: 'other' }),
    ).rejects.toThrow('statistics collection dedupeKey must equal its stable operationKey')

    await expect(
      reservations.reserveStatisticsCollection(collectionInput({ workClass: 'maintenance' as 'global-statistics' })),
    ).rejects.toThrow('statistics collection requires global-statistics work class')

    await expect(
      reservations.reserveStatisticsCollection(collectionInput({ payload: { cohortId: 'no', brawlhallaId: 42 } })),
    ).rejects.toThrow('statistics collection cohortId must be a UUID')

    await expect(
      reservations.reserveStatisticsCollection(
        collectionInput({ payload: { cohortId: randomUUID(), brawlhallaId: 0 } }),
      ),
    ).rejects.toThrow('statistics collection brawlhallaId must be a positive safe integer')

    await expect(
      reservations.reserveStatisticsPublication(
        publicationInput({ payload: { generationId: randomUUID(), product: 'x' as 'ranked' } }),
      ),
    ).rejects.toThrow('statistics publication product is unsupported')

    await expect(
      reservations.reserveStatisticsPublication(
        publicationInput({ payload: { generationId: 'no', product: 'ranked' } }),
      ),
    ).rejects.toThrow('statistics publication generationId must be a UUID')

    await expect(
      reservations.reserveStatisticsLegendMetaPublication(legendMetaInput({ payload: { generationId: 'no' } })),
    ).rejects.toThrow('Statistics Legend Meta publication generationId must be a UUID')
  })
})
