import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  type AdmissionConfig,
  createPostgresRefreshOperations,
  type OperationFailure,
  type OperationLease,
  queueModule,
} from '@brawltome/queue'
import { testJobContract } from '@brawltome/queue/testing'

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

// names from the source can carry a NUL into the message and into anything an error attaches
const failureWithNul = {
  code: 'player_refresh_failed',
  message: 'refresh player Bad\u0000Name',
  retryable: false,
  details: { 'guild\u0000': { names: ['Clan\u0000One'] } },
} as OperationFailure

const storedFailure = {
  code: 'player_refresh_failed',
  message: 'refresh player Bad\uFFFDName',
  retryable: false,
  details: { 'guild\uFFFD': { names: ['Clan\uFFFDOne'] } },
}

beforeAll(async () => {
  database = await createTestDatabase({ label: 'settle_operation', modules: [queueModule] })
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  await database.sql`DELETE FROM queue.operations`
})

function createQueue() {
  return createPostgresRefreshOperations({ database }, { jobs: [testJobContract] })
}

async function claimNewOperation(): Promise<OperationLease> {
  const id = randomUUID()

  await database.sql`
    INSERT INTO queue.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts)
    VALUES
      (${id}, ${id}, ${testJobContract.kind}, ${`settle:${id}`}, ${`settle:${id}`}, 'maintenance',
       ${database.sql.json({ value: 'stored' })}, ${database.sql.json({ source: 'integration-test' })}, 3)
  `

  const lease = await createQueue().claim('worker', 10_000, admission)

  if (lease?.operationId !== id) throw new Error(`claim operation ${id}: got ${lease?.operationId ?? 'nothing'}`)

  return lease
}

async function readOperation(operationId: string) {
  const [row] = await database.sql<{ status: string; last_error: unknown }[]>`
    SELECT status, last_error FROM queue.operations WHERE id = ${operationId}
  `

  return row
}

async function readAttemptErrors(operationId: string): Promise<unknown[]> {
  const rows = await database.sql<{ error: unknown }[]>`
    SELECT error FROM queue.attempts WHERE operation_id = ${operationId}
  `

  return rows.map(({ error }) => error)
}

describe('settling an operation whose failure contains NUL', () => {
  test('fail dead-letters it and stores the failure with NUL replaced', async () => {
    const lease = await claimNewOperation()

    expect(await createQueue().fail(lease, failureWithNul, 0)).toBe('transitioned')

    expect(await readOperation(lease.operationId)).toEqual({ status: 'dead_letter', last_error: storedFailure })
    expect(await readAttemptErrors(lease.operationId)).toEqual([storedFailure])
  })

  test('defer puts it back and stores the failure with NUL replaced', async () => {
    const lease = await claimNewOperation()

    expect(await createQueue().defer(lease, failureWithNul, 0)).toBe('transitioned')

    expect(await readOperation(lease.operationId)).toEqual({ status: 'pending', last_error: storedFailure })
  })
})
