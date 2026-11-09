import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import {
  acceptOperation,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type DeadLetterHooks,
  type InvalidRow,
  type JobContract,
  type OperationLease,
  queueModule,
  reconcileFixedSchedule,
  reconcileResourceSchedules,
  reserveForAdmission,
  reserveForBinding,
} from '@brawltome/queue'
import { createTestJobContract, testJobContract } from '@brawltome/queue/testing'
import { testWatermark } from './test-watermark'

let database: TestDatabase

const noHooks: DeadLetterHooks = { replayGuards: new Map(), describeEffects: new Map() }

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
    'primary-monitoring': 5,
    leaderboard: 4,
    'global-statistics': 3,
    projection: 2,
    maintenance: 1,
  },
} as const

const provenance = { source: 'integration-test' }

beforeAll(async () => {
  database = await createTestDatabase({ label: 'refresh_operations_contracts', modules: [queueModule] })
})

afterAll(async () => {
  await database?.drop()
})

function createQueue(
  jobs: readonly JobContract<unknown>[] = [testJobContract],
  onInvalidRow?: (row: InvalidRow) => void,
) {
  return createPostgresRefreshOperations({ database }, { jobs, onInvalidRow })
}

type RowOverrides = { kind?: string; workClass?: string; payload?: unknown; availableAt?: Date }

// written the way a bug or another release would, past every check in the write paths
async function insertRow({
  kind = testJobContract.kind,
  workClass = 'maintenance',
  payload = { value: 'stored' },
  availableAt = new Date(Date.now() - 60_000),
}: RowOverrides = {}): Promise<string> {
  const id = randomUUID()

  await database.sql`
    INSERT INTO queue.operations
      (id, effect_operation_id, kind, dedupe_key, operation_key, work_class, payload, provenance, max_attempts,
       available_at)
    VALUES
      (${id}, ${id}, ${kind}, ${`row:${id}`}, ${`row:${id}`}, ${workClass},
       ${database.sql.json(payload as never)}, ${database.sql.json(provenance)}, 3, ${availableAt})
  `

  return id
}

async function readOperation(operationId: string) {
  const [row] = await database.sql<
    {
      status: string
      attempt_count: number
      last_error: { code: string; message: string; retryable: boolean } | null
    }[]
  >`
    SELECT status, attempt_count, last_error FROM queue.operations WHERE id = ${operationId}
  `

  return row
}

async function drainDueOperations(): Promise<void> {
  await database.sql`UPDATE queue.operations SET status = 'succeeded', lease_owner = NULL,
    lease_expires_at = NULL, completed_at = clock_timestamp() WHERE status IN ('pending', 'leased')`
}

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')

  return lease
}

describe('claim on a row its release cannot run', () => {
  test('a row with an unknown kind goes to dead letter with invalid_payload and the next row is still claimed', async () => {
    await drainDueOperations()

    const unknown = await insertRow({ kind: 'kind-from-another-release' })
    const next = await insertRow({ availableAt: new Date(Date.now() - 30_000) })

    const lease = requireLease(await createQueue().claim('worker', 10_000, admission))

    expect(lease.operationId).toBe(next)

    expect(await readOperation(unknown)).toMatchObject({
      status: 'dead_letter',
      attempt_count: 0,
      last_error: { code: 'invalid_payload', retryable: false },
    })
  })

  test('a row claim dead-letters is reported with its kind and reason', async () => {
    await drainDueOperations()

    const unknown = await insertRow({ kind: 'kind-from-another-release' })
    const reported: InvalidRow[] = []

    await createQueue([testJobContract], (row) => reported.push(row)).claim('worker', 10_000, admission)

    expect(reported).toEqual([
      {
        operationId: unknown,
        kind: 'kind-from-another-release',
        reason: 'No job is registered for kind kind-from-another-release',
      },
    ])
  })

  test("a payload that doesn't parse does the same", async () => {
    await drainDueOperations()

    const unparseable = await insertRow({ payload: { value: 42 } })
    const next = await insertRow({ availableAt: new Date(Date.now() - 30_000) })

    const lease = requireLease(await createQueue().claim('worker', 10_000, admission))

    expect(lease.operationId).toBe(next)

    expect(await readOperation(unparseable)).toMatchObject({
      status: 'dead_letter',
      attempt_count: 0,
      last_error: { code: 'invalid_payload', retryable: false },
    })
  })

  test('a work class the job does not run in does the same', async () => {
    await drainDueOperations()

    const job = createTestJobContract('test-job-interactive-only', ['interactive'])
    const misfiled = await insertRow({ kind: job.kind, workClass: 'maintenance' })

    expect(await createQueue([job]).claim('worker', 10_000, admission)).toBeNull()
    expect((await readOperation(misfiled)).last_error?.code).toBe('invalid_payload')
  })

  test('a kind named after an object property is still unknown', async () => {
    await drainDueOperations()

    const inherited = await insertRow({ kind: 'constructor' })

    expect(await createQueue().claim('worker', 10_000, admission)).toBeNull()
    expect((await readOperation(inherited)).last_error?.code).toBe('invalid_payload')
  })

  test('a run of bad rows ends in one claim call rather than stalling it', async () => {
    await drainDueOperations()

    const badRows = await Promise.all(Array.from({ length: 5 }, () => insertRow({ kind: 'kind-from-another-release' })))
    const next = await insertRow({ availableAt: new Date(Date.now() - 1_000) })

    expect(requireLease(await createQueue().claim('worker', 10_000, admission)).operationId).toBe(next)

    for (const operationId of badRows) expect((await readOperation(operationId)).status).toBe('dead_letter')
  })

  test('a player refresh whose brawlhallaId is not a number can still be dead-lettered', async () => {
    await drainDueOperations()

    const unparseable = await insertRow({
      kind: 'interactive-player-refresh',
      workClass: 'interactive',
      payload: { brawlhallaId: 'not-a-number', staleSections: ['ranked'] },
    })

    expect(await createQueue().claim('worker', 10_000, admission)).toBeNull()
    expect((await readOperation(unparseable)).last_error?.code).toBe('invalid_payload')
  })

  test('an expired lease on an unknown kind closes its attempt', async () => {
    await drainDueOperations()

    const expired = await insertRow({ kind: 'kind-from-another-release' })

    await database.sql`
      UPDATE queue.operations
      SET status = 'leased', lease_owner = 'old-worker', lease_token = 1, attempt_count = 1,
          lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${expired}
    `

    await database.sql`
      INSERT INTO queue.attempts (operation_id, attempt_number, lease_token, lease_owner)
      VALUES (${expired}, 1, 1, 'old-worker')
    `

    expect(await createQueue().claim('worker', 10_000, admission)).toBeNull()
    expect((await readOperation(expired)).last_error?.code).toBe('invalid_payload')

    const [attempt] = await database.sql<{ outcome: string; finished_at: Date | null }[]>`
      SELECT outcome, finished_at FROM queue.attempts WHERE operation_id = ${expired}
    `

    expect(attempt.outcome).toBe('dead_letter')
    expect(attempt.finished_at).not.toBeNull()
  })

  test('a kind this release does not know replays once a release that knows it runs', async () => {
    await drainDueOperations()

    const job = createTestJobContract('test-job-from-a-newer-release')

    const accepted = await createQueue([job]).accept({
      job,
      dedupeKey: `rollback:${randomUUID()}`,
      operationKey: `rollback:${randomUUID()}`,
      workClass: 'maintenance',
      payload: { value: 'written by the newer release' },
      provenance,
    })

    expect(await createQueue().claim('rolled-back-worker', 10_000, admission)).toBeNull()
    expect((await readOperation(accepted.operationId)).status).toBe('dead_letter')

    const replay = await createPostgresDeadLetterOperations(database, noHooks).replayDeadLetter({
      operationId: accepted.operationId,
      actorId: 'operator',
      reason: 'rolled forward again',
    })

    if (replay.outcome !== 'replayed') throw new Error('expected the dead letter to replay')

    const lease = requireLease(await createQueue([job]).claim('rolled-forward-worker', 10_000, admission))

    expect(lease.operationId).toBe(replay.replayOperationId)
    expect(lease.effectOperationId).toBe(accepted.operationId)
    expect(lease.kind as string).toBe(job.kind)
  })

  test('an invalid_payload dead letter stays out of the series the gauge keeps', async () => {
    await drainDueOperations()

    const queue = createQueue()
    const before = await queue.inspectTelemetry()

    await insertRow({ kind: 'kind-from-another-release' })
    await insertRow({ kind: 'proof', payload: { value: 42 } })

    expect(await queue.claim('worker', 10_000, admission)).toBeNull()

    const after = await queue.inspectTelemetry()

    expect(after.deadLetters).toHaveLength(before.deadLetters.length)
    expect(after.deadLetters.some(({ kind }) => (kind as string) === 'kind-from-another-release')).toBe(false)

    expect(new Set(after.deadLetters.map(({ reason }) => reason))).toEqual(
      new Set(before.deadLetters.map(({ reason }) => reason)),
    )
  })
})

describe('write paths', () => {
  const badPayload = { value: 42 } as unknown as { value: string }

  function writeKeys() {
    const key = randomUUID()

    return { dedupeKey: `write:${key}`, operationKey: `write:${key}` }
  }

  async function countRows(dedupeKey: string): Promise<number> {
    const [row] = await database.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM queue.operations WHERE dedupe_key = ${dedupeKey}
    `

    return Number(row.count)
  }

  test('accept and reserve reject a payload that fails parsePayload', async () => {
    const job = testJobContract
    const common = { job, workClass: 'maintenance' as const, payload: badPayload, provenance }
    const keys = writeKeys()

    await expect(createQueue().accept({ ...common, ...keys })).rejects.toThrow('test job value must be a string')
    await expect(acceptOperation(database, { ...common, ...keys })).rejects.toThrow('test job value must be a string')

    await expect(
      reserveForAdmission(database, { ...common, ...keys, maxAttempts: 3, reservationTtlSeconds: 60 }),
    ).rejects.toThrow('test job value must be a string')

    await expect(
      reserveForBinding(database, { ...common, ...keys, lockNamespace: 209, mismatchMessage: 'mismatch' }),
    ).rejects.toThrow('test job value must be a string')

    expect(await countRows(keys.dedupeKey)).toBe(0)
  })

  test('accept and reserve reject a work class the job does not run in', async () => {
    const job = createTestJobContract('test-job-interactive-only', ['interactive'])
    const keys = writeKeys()

    await expect(
      acceptOperation(database, {
        job,
        ...keys,
        workClass: 'maintenance',
        payload: { value: 'valid' },
        provenance,
      }),
    ).rejects.toThrow('work class maintenance')

    expect(await countRows(keys.dedupeKey)).toBe(0)
  })

  test('schedules reject a payload that fails parsePayload', async () => {
    const definition = {
      scheduleKey: `schedule:${randomUUID()}`,
      operationKeyPrefix: `schedule:${randomUUID()}`,
      workClass: 'maintenance' as const,
      intervalMs: 3_600_000,
      firstDueAt: '2026-01-01T00:00:00.000Z',
      provenance,
    }

    await expect(
      createQueue().createSchedule({ ...definition, job: testJobContract, payload: badPayload }),
    ).rejects.toThrow('test job value must be a string')

    await expect(
      reconcileFixedSchedule(database, {
        job: testJobContract,
        schedule: { ...definition, kind: 'test-job', payload: badPayload },
      } as never),
    ).rejects.toThrow('test job value must be a string')

    await expect(
      reconcileResourceSchedules(database, {
        provenanceSource: 'contract-test',
        observedAt: new Date(),
        schedules: [
          {
            ...definition,
            job: testJobContract,
            resourceKey: 'player:1',
            payload: badPayload,
            maxAttempts: 3,
          },
        ],
        watermark: testWatermark,
        identityPayloadFields: [],
      }),
    ).rejects.toThrow('test job value must be a string')
  })

  test('a kind with no migration can be accepted', async () => {
    await drainDueOperations()

    const job = createTestJobContract('test-job-with-no-migration')
    const queue = createQueue([job])
    const keys = writeKeys()

    const accepted = await queue.accept({
      job,
      ...keys,
      workClass: 'maintenance',
      payload: { value: 'no migration needed' },
      provenance,
    })

    expect(accepted.outcome).toBe('accepted')

    const lease = requireLease(await queue.claim('worker', 10_000, admission))

    expect(lease.operationId).toBe(accepted.operationId)
    expect(lease.payload).toEqual({ value: 'no migration needed' })
  })

  test('a schedule of a kind with no migration can be stored', async () => {
    const job = createTestJobContract('test-job-with-no-migration')

    const created = await createQueue([job]).createSchedule({
      job,
      scheduleKey: `schedule:${randomUUID()}`,
      operationKeyPrefix: `schedule:${randomUUID()}`,
      workClass: 'maintenance',
      intervalMs: 3_600_000,
      firstDueAt: '2026-01-01T00:00:00.000Z',
      payload: { value: 'scheduled' },
      provenance,
    })

    expect(created.outcome).toBe('created')
  })

  test('a section the table has never seen can be recorded', async () => {
    const operationId = await insertRow()

    await database.sql`
      INSERT INTO queue.interactive_refresh_effects (operation_id, section, lease_token)
      VALUES (${operationId}, 'a-section-with-no-migration', 1)
    `

    const [row] = await database.sql<{ section: string }[]>`
      SELECT section FROM queue.interactive_refresh_effects WHERE operation_id = ${operationId}
    `

    expect(row.section).toBe('a-section-with-no-migration')
  })

  test('the kind, payload and section checks are gone', async () => {
    const constraints = await database.sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('queue.operations'::regclass, 'queue.schedules'::regclass,
                         'queue.interactive_refresh_effects'::regclass)
        AND conname IN ('operations_kind_check', 'operations_payload_by_kind', 'schedules_kind_check',
                        'schedules_payload_by_kind', 'interactive_refresh_effects_section_check')
    `

    expect(constraints.map(({ conname }) => conname)).toEqual([])
  })
})
