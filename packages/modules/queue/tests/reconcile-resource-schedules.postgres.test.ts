import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { type ResourceSchedule, reconcileResourceSchedules, refreshOperationsModule } from '@brawltome/queue'
import { createPassthroughJobContract } from '@brawltome/queue/testing'
import { testWatermark } from './test-watermark'

let database: TestDatabase

const provenanceSource = 'integration-test-monitoring'
const firstDueAt = '2026-08-10T00:00:00.000Z'

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'refresh_operations_resource_schedules',
    modules: [refreshOperationsModule],
  })
})

afterAll(async () => {
  await database?.drop()
})

function schedule(
  overrides: { brawlhallaId?: number; assignmentId?: string; firstDueAt?: string } = {},
): ResourceSchedule {
  const brawlhallaId = overrides.brawlhallaId ?? 7_001
  const assignmentId = overrides.assignmentId ?? randomUUID()

  return {
    job: createPassthroughJobContract('interactive-player-refresh'),
    scheduleKey: `test-monitoring:${brawlhallaId}:${assignmentId}`,
    operationKeyPrefix: `test-monitoring:${brawlhallaId}`,
    resourceKey: `player:${brawlhallaId}`,
    workClass: 'primary-monitoring',
    intervalMs: 86_400_000,
    firstDueAt: overrides.firstDueAt ?? firstDueAt,
    payload: { assignmentId, brawlhallaId, staleSections: ['ranked', 'stats'] },
    provenance: { source: provenanceSource, requestedBy: 'test' },
    maxAttempts: 3,
  }
}

function reconcile(schedules: ResourceSchedule[], observedAt: Date) {
  return reconcileResourceSchedules(database, {
    provenanceSource,
    observedAt,
    schedules,
    watermark: testWatermark,
    identityPayloadFields: ['assignmentId', 'brawlhallaId'],
  })
}

function enabledCount() {
  return database.sql<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM refresh_operations.schedules
    WHERE enabled AND provenance->>'source' = ${provenanceSource}
  `.then(([row]) => row.count)
}

async function clearWatermark(): Promise<void> {
  await database.sql`DELETE FROM refresh_operations.primary_monitoring_reconciliation`
}

describe('reconcileResourceSchedules', () => {
  test('creates, keeps, retires and replaces schedules against the desired set', async () => {
    await clearWatermark()

    const wanted = schedule()
    const start = Date.now() + 1_000

    expect(await reconcile([wanted], new Date(start))).toEqual({ created: 1, retired: 0 })
    expect(await reconcile([wanted], new Date(start + 1))).toEqual({ created: 0, retired: 0 })
    expect(await enabledCount()).toBe(1)

    // a new assignment for the same resource retires the old schedule and starts a new one
    expect(await reconcile([schedule({ brawlhallaId: 7_001 })], new Date(start + 2))).toEqual({
      created: 1,
      retired: 1,
    })

    expect(await enabledCount()).toBe(1)

    expect(await reconcile([], new Date(start + 3))).toEqual({ created: 0, retired: 1 })
    expect(await enabledCount()).toBe(0)
  })

  test('replaces a schedule whose first due time changed', async () => {
    await clearWatermark()

    const original = schedule({ brawlhallaId: 7_002 })
    const start = Date.now() + 10_000

    await reconcile([original], new Date(start))

    const moved = { ...original, firstDueAt: '2026-08-11T00:00:00.000Z' }

    expect(await reconcile([moved], new Date(start + 1))).toEqual({ created: 1, retired: 1 })
    expect(await reconcile([], new Date(start + 2))).toEqual({ created: 0, retired: 1 })
  })

  test('ignores a snapshot no newer than the last one applied, so a slow replica cannot undo it', async () => {
    await clearWatermark()

    const start = Date.now() + 20_000

    await reconcile([schedule({ brawlhallaId: 7_003 })], new Date(start))

    expect(await reconcile([], new Date(start))).toEqual({ created: 0, retired: 0 })
    expect(await reconcile([], new Date(start - 1))).toEqual({ created: 0, retired: 0 })
    expect(await enabledCount()).toBe(1)

    expect(await reconcile([], new Date(start + 1))).toEqual({ created: 0, retired: 1 })
  })

  test('rejects a schedule with an invalid identity before touching the database', async () => {
    await clearWatermark()

    await expect(reconcile([{ ...schedule(), scheduleKey: '' }], new Date(Date.now() + 30_000))).rejects.toThrow(
      'scheduleKey must contain between 1 and 200 characters',
    )

    await expect(
      reconcile([{ ...schedule(), firstDueAt: 'not-a-timestamp' }], new Date(Date.now() + 30_000)),
    ).rejects.toThrow('firstDueAt must be an ISO-8601 UTC timestamp ending in Z')
  })
})
