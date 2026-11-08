import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  allSectionsCommitted,
  refreshOperationsModule,
  reserveForAdmission,
  sectionCommitted,
} from '@brawltome/refresh-operations'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_sections', modules: [refreshOperationsModule] })
})

afterAll(async () => {
  await database?.drop()
})

async function reserveEffectOperation(): Promise<string> {
  const key = randomUUID()

  const reserved = await reserveForAdmission(database, {
    kind: 'proof',
    dedupeKey: `sections:${key}`,
    operationKey: `sections:${key}`,
    workClass: 'interactive',
    payload: { value: 'sections' },
    provenance: { source: 'integration-test' },
    maxAttempts: 3,
    reservationTtlSeconds: 60,
  })

  if (reserved.outcome !== 'reserved') throw new Error('expected a reservation')

  return reserved.operationId
}

async function recordCheckpoint(effectOperationId: string, section: string): Promise<void> {
  await database.sql`
    INSERT INTO refresh_operations.interactive_refresh_effects (operation_id, section, lease_token)
    VALUES (${effectOperationId}, ${section}, 1)
  `
}

describe('allSectionsCommitted', () => {
  test('is acknowledged only once every requested section has a checkpoint', async () => {
    const effectOperationId = await reserveEffectOperation()
    const lease = { effectOperationId }

    expect(await allSectionsCommitted(database.sql, lease, ['profile', 'roster'])).toBe('none')

    await recordCheckpoint(effectOperationId, 'profile')

    expect(await allSectionsCommitted(database.sql, lease, ['profile', 'roster'])).toBe('none')
    expect(await allSectionsCommitted(database.sql, lease, ['profile'])).toBe('acknowledged')

    await recordCheckpoint(effectOperationId, 'roster')

    expect(await allSectionsCommitted(database.sql, lease, ['profile', 'roster'])).toBe('acknowledged')
  })

  test('reads checkpoints of the effect operation only', async () => {
    const effectOperationId = await reserveEffectOperation()
    const otherEffectOperationId = await reserveEffectOperation()

    await recordCheckpoint(otherEffectOperationId, 'profile')

    expect(await allSectionsCommitted(database.sql, { effectOperationId }, ['profile'])).toBe('none')
  })

  test('treats an empty section list as committed', async () => {
    const effectOperationId = await reserveEffectOperation()

    expect(await allSectionsCommitted(database.sql, { effectOperationId }, [])).toBe('acknowledged')
  })
})

describe('sectionCommitted', () => {
  test('is acknowledged once that section has a checkpoint on the effect operation', async () => {
    const effectOperationId = await reserveEffectOperation()
    const lease = { effectOperationId }

    expect(await sectionCommitted(database.sql, lease, 'ranked')).toBe('none')

    await recordCheckpoint(effectOperationId, 'stats')

    expect(await sectionCommitted(database.sql, lease, 'ranked')).toBe('none')

    await recordCheckpoint(effectOperationId, 'ranked')

    expect(await sectionCommitted(database.sql, lease, 'ranked')).toBe('acknowledged')
  })
})
