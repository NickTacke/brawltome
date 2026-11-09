import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  createPostgresRefreshOperations,
  reconcileFixedSchedule,
  refreshOperationsModule,
} from '@brawltome/refresh-operations'
import { createPassthroughJobContract } from '@brawltome/refresh-operations/testing'

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'materialize_leaderboard_guard', modules: [refreshOperationsModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

const leaderboardContract = createPassthroughJobContract('leaderboard-1v1')

describe('materializeDueSchedules', () => {
  test('refuses to supersede a leaderboard window without the applied effect reader', async () => {
    const intervalMs = 60_000

    await reconcileFixedSchedule(database, {
      job: leaderboardContract,
      schedule: {
        scheduleKey: `guard:${randomUUID()}`,
        operationKeyPrefix: `guard:${randomUUID()}`,
        kind: 'leaderboard-1v1',
        workClass: 'leaderboard',
        intervalMs,
        firstDueAt: new Date(Date.now() - 1_000).toISOString(),
        payload: { pageDepth: 1, intervalMs },
        provenance: { source: 'integration-test', requestedBy: 'guard' },
      },
    })

    const operations = createPostgresRefreshOperations({ database }, { jobs: [leaderboardContract] })

    await expect(operations.materializeDueSchedules()).rejects.toThrow('no applied effect reader was configured')
  })
})
