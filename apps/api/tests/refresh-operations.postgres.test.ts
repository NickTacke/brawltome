import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { OperationLease } from '@brawltome/refresh-operations'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import postgres from 'postgres'
import { runOneProofOperation } from '../src/refresh-operations-worker'
import { createRefreshOperationRoutes } from '../src/routes/refresh-operations.routes'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_operations_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

const testAdmission = {
  totalConcurrency: 8,
  interactiveReservation: 2,
  classConcurrency: {
    interactive: 4,
    'primary-monitoring': 2,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 2,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 8,
    leaderboard: 4,
    'global-statistics': 2,
    projection: 4,
    maintenance: 1,
  },
} as const

function requireLease(lease: OperationLease | null): OperationLease {
  if (!lease) throw new Error('Expected an operation lease')
  return lease
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Refresh Operations integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of refreshOperationsMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
})

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

async function expire(operationId: string) {
  const control = postgres(connectionString, { max: 1 })
  try {
    await control`
      UPDATE refresh_operations.operations
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${operationId}
    `
  } finally {
    await control.end()
  }
}

describe('durable Refresh Operations', () => {
  test('deduplicates acceptance, notifies, and reconciles a final-attempt crash after one effect', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    let notifiedOperationId = ''
    let resolveNotification: (() => void) | undefined
    const notification = new Promise<void>((resolve) => {
      resolveNotification = resolve
    })
    const listener = await producer.listen((operationId) => {
      notifiedOperationId = operationId
      resolveNotification?.()
    })
    const input = {
      dedupeKey: `proof:${randomUUID()}`,
      operationKey: `effect:${randomUUID()}`,
      workClass: 'interactive' as const,
      payload: { value: 'once' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 1,
    }
    const accepted = await Promise.all(Array.from({ length: 20 }, () => producer.accept(input)))
    expect(new Set(accepted.map(({ operationId }) => operationId)).size).toBe(1)
    expect(accepted.filter(({ outcome }) => outcome === 'accepted')).toHaveLength(1)
    await notification
    expect(notifiedOperationId).toBe(accepted[0].operationId)
    await listener.unlisten()
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    const lease = requireLease(await worker.claim('worker-a', 1_000, testAdmission))
    expect(await worker.commitProofEffect(lease)).toBe('applied')
    await expire(lease.operationId)
    expect(await worker.commitProofEffect(lease)).toBe('lease-lost')
    expect(await worker.claim('worker-b', 1_000, testAdmission)).toBeNull()

    const state = await worker.inspect(lease.operationId)
    expect(state.operation.status).toBe('succeeded')
    expect(state.effects).toHaveLength(1)
    expect(state.attempts.map(({ outcome }) => outcome)).toEqual(['succeeded'])
    const afterTerminal = await worker.accept({ ...input, operationKey: `effect:${randomUUID()}` })
    expect(afterTerminal).toMatchObject({ outcome: 'accepted' })
    expect(afterTerminal.operationId).not.toBe(lease.operationId)
    expect(
      await runOneProofOperation(worker, 'worker-c', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    await worker.close()
  })

  test('rejects expired and superseded leases and detects conflicting effect keys', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const accepted = await operations.accept({
      dedupeKey: `fence:${randomUUID()}`,
      operationKey: `shared-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'A' },
      provenance: { source: 'integration-test' },
    })
    const stale = requireLease(await operations.claim('worker-a', 1_000, testAdmission))
    await expire(stale.operationId)
    expect(await operations.commitProofEffect(stale)).toBe('lease-lost')
    const current = requireLease(await operations.claim('worker-b', 1_000, testAdmission))
    expect(current.leaseToken).toBeGreaterThan(stale.leaseToken)
    expect(await operations.complete(stale)).toBe('lease-lost')
    expect(await operations.commitProofEffect(current)).toBe('applied')
    expect(await operations.complete(current)).toBe('transitioned')

    const conflicting = await operations.accept({
      dedupeKey: `conflict:${randomUUID()}`,
      operationKey: current.operationKey,
      workClass: 'interactive',
      payload: { value: 'B' },
      provenance: { source: 'integration-test' },
    })
    expect(
      await runOneProofOperation(operations, 'worker-c', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    const conflictState = await operations.inspect(conflicting.operationId)
    expect(conflictState.operation).toMatchObject({
      status: 'dead_letter',
      last_error: { code: 'effect_conflict', retryable: false },
    })
    expect(conflictState.effects).toHaveLength(0)
    expect((await operations.inspect(accepted.operationId)).effects).toHaveLength(1)
    await operations.close()
  })

  test('runs the real route-to-polling-worker seam and dead-letters bounded runtime failures', async () => {
    const producer = createPostgresRefreshOperations(connectionString)
    const secret = 'operations-integration-secret-operations'
    const app = createRefreshOperationRoutes(producer, secret)
    const response = await app.request('/proof', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        dedupeKey: `route:${randomUUID()}`,
        operationKey: `route-effect:${randomUUID()}`,
        value: 'from-route',
      }),
    })
    const accepted = (await response.json()) as { operationId: string }
    expect(response.status).toBe(202)
    await producer.close()

    const worker = createPostgresRefreshOperations(connectionString)
    expect(
      await runOneProofOperation(worker, 'poll-worker', {
        leaseMs: 1_000,
        retryDelayMs: 1,
        admission: testAdmission,
      }),
    ).toBe(true)
    expect((await worker.inspect(accepted.operationId)).operation.status).toBe('succeeded')

    const poison = await worker.accept({
      dedupeKey: `poison:${randomUUID()}`,
      operationKey: `poison-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      maxAttempts: 2,
    })
    const failEffect = async () => {
      throw new Error('Deliberate proof failure')
    }
    const options = {
      leaseMs: 1_000,
      retryDelayMs: 0,
      admission: testAdmission,
      executeEffect: failEffect,
    }
    expect(await runOneProofOperation(worker, 'worker-a', options)).toBe(true)
    expect(await runOneProofOperation(worker, 'worker-b', options)).toBe(true)

    const state = await worker.inspect(poison.operationId)
    expect(state.operation).toMatchObject({
      status: 'dead_letter',
      payload: { value: 'poison' },
      provenance: { source: 'integration-test', requestedBy: 'issue-190' },
      attempt_count: 2,
      last_error: {
        code: 'proof_execution_failed',
        message: 'Deliberate proof failure',
        retryable: true,
      },
    })
    expect(state.attempts).toHaveLength(2)
    expect(state.attempts.every(({ outcome, error }) => outcome && error?.code === 'proof_execution_failed')).toBe(true)
    expect(state.effects).toHaveLength(0)
    await worker.close()
  })

  test('coalesces missed windows once and retains anchored history after repository restart', async () => {
    const intervalMs = 3_600_000
    const firstDueAt = new Date(Date.now() - 5 * intervalMs - 10_000).toISOString()
    const schedulers = [
      createPostgresRefreshOperations(connectionString),
      createPostgresRefreshOperations(connectionString),
    ]
    await expect(
      schedulers[0].createSchedule({
        scheduleKey: `invalid-offset:${randomUUID()}`,
        operationKeyPrefix: 'invalid-offset',
        workClass: 'projection',
        intervalMs,
        firstDueAt: firstDueAt.replace('Z', '+00:00'),
        payload: { value: 'invalid' },
        provenance: { source: 'integration-test' },
      }),
    ).rejects.toThrow('UTC timestamp')
    await expect(
      schedulers[0].createSchedule({
        scheduleKey: `invalid-date:${randomUUID()}`,
        operationKeyPrefix: 'invalid-date',
        workClass: 'projection',
        intervalMs,
        firstDueAt: '2023-02-29T00:00:00Z',
        payload: { value: 'invalid' },
        provenance: { source: 'integration-test' },
      }),
    ).rejects.toThrow('valid timestamp')
    const scheduleDefinition = {
      scheduleKey: `catch-up:${randomUUID()}`,
      operationKeyPrefix: `catch-up-effect:${randomUUID()}`,
      workClass: 'projection' as const,
      intervalMs,
      firstDueAt,
      payload: { value: 'catch-up' },
      provenance: { source: 'integration-test', requestedBy: 'issue-192' },
    }
    const created = await schedulers[0].createSchedule(scheduleDefinition)
    expect(await schedulers[1].createSchedule(scheduleDefinition)).toEqual({
      outcome: 'already-exists',
      scheduleId: created.scheduleId,
    })

    const materialized = await Promise.all(
      Array.from({ length: 20 }, (_, index) => schedulers[index % schedulers.length].materializeDueSchedules(1)),
    )
    expect(materialized.reduce((total, result) => total + result.occurrencesCreated, 0)).toBe(1)
    await Promise.all(schedulers.map((scheduler) => scheduler.close()))

    const restarted = createPostgresRefreshOperations(connectionString)
    const history = await restarted.inspectSchedule(created.scheduleId)
    expect(history.occurrences).toHaveLength(1)
    expect(history.occurrences[0]).toMatchObject({
      first_window_number: '0',
      last_window_number: '5',
      missed_window_count: '5',
      catch_up: true,
      operation_status: 'pending',
    })
    expect(Number(history.occurrences[0].lateness_ms)).toBeGreaterThanOrEqual(5 * intervalMs + 10_000)
    expect(history.schedule.next_window_number).toBe('6')
    expect(history.schedule.next_due_at.getTime()).toBe(new Date(firstDueAt).getTime() + 6 * intervalMs)
    expect(history.schedule.next_due_at.getTime()).toBeGreaterThan(Date.now())

    const lease = requireLease(await restarted.claim('schedule-cleanup', 10_000, testAdmission))
    expect(lease.workClass).toBe('projection')
    expect(await restarted.complete(lease)).toBe('transitioned')
    await restarted.close()
  })

  test('keeps scheduled effects idempotent without colliding across schedules', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const sharedPrefix = `shared-schedule-effect:${randomUUID()}`
    const firstDueAt = new Date(Date.now() - 1_000).toISOString()
    for (let index = 0; index < 2; index += 1) {
      await operations.createSchedule({
        scheduleKey: `shared-prefix:${index}:${randomUUID()}`,
        operationKeyPrefix: sharedPrefix,
        workClass: 'projection',
        intervalMs: 3_600_000,
        firstDueAt,
        payload: { value: `${index}` },
        provenance: { source: 'integration-test', requestedBy: 'issue-192' },
      })
    }
    expect(await operations.materializeDueSchedules()).toMatchObject({ occurrencesCreated: 2 })
    const leases = [
      requireLease(await operations.claim('shared-prefix-1', 10_000, testAdmission)),
      requireLease(await operations.claim('shared-prefix-2', 10_000, testAdmission)),
    ]
    expect(new Set(leases.map(({ operationKey }) => operationKey)).size).toBe(2)
    for (const lease of leases) {
      expect(await operations.commitProofEffect(lease)).toBe('applied')
      expect(await operations.complete(lease)).toBe('transitioned')
    }
    await operations.close()
  })

  test('allows background borrowing but restores the interactive reservation without preemption', async () => {
    const operations = createPostgresRefreshOperations(connectionString)
    const admission = {
      ...testAdmission,
      totalConcurrency: 4,
      interactiveReservation: 1,
      classConcurrency: {
        ...testAdmission.classConcurrency,
        interactive: 2,
        maintenance: 4,
      },
    } as const
    await operations.configureAdmission(admission)
    for (let index = 0; index < 4; index += 1) {
      await operations.accept({
        dedupeKey: `borrow:${randomUUID()}`,
        operationKey: `borrow-effect:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: `${index}` },
        provenance: { source: 'integration-test' },
      })
    }
    const claimers = Array.from({ length: 8 }, () => createPostgresRefreshOperations(connectionString))
    const concurrentClaims = await Promise.all(
      claimers.map((claimer, index) => claimer.claim(`background-${index}`, 10_000, admission)),
    )
    const backgroundLeases = concurrentClaims.filter((lease): lease is OperationLease => lease !== null)
    expect(backgroundLeases).toHaveLength(4)
    expect(backgroundLeases.every(({ workClass }) => workClass === 'maintenance')).toBe(true)
    await Promise.all(claimers.map((claimer) => claimer.close()))

    await operations.accept({
      dedupeKey: `interactive:${randomUUID()}`,
      operationKey: `interactive-effect:${randomUUID()}`,
      workClass: 'interactive',
      payload: { value: 'interactive' },
      provenance: { source: 'integration-test' },
    })
    expect(await operations.claim('interactive-blocked', 10_000, admission)).toBeNull()
    expect(await operations.complete(backgroundLeases.pop() as OperationLease)).toBe('transitioned')
    const interactive = requireLease(await operations.claim('interactive-priority', 10_000, admission))
    expect(interactive.workClass).toBe('interactive')

    for (const lease of [...backgroundLeases, interactive]) {
      expect(await operations.complete(lease)).toBe('transitioned')
    }
    await operations.close()
  })

  test('enforces class bounds and persists deterministic weighted admission across replicas', async () => {
    const admission = {
      ...testAdmission,
      totalConcurrency: 4,
      interactiveReservation: 1,
      classConcurrency: {
        interactive: 2,
        'primary-monitoring': 4,
        leaderboard: 4,
        'global-statistics': 1,
        projection: 1,
        maintenance: 1,
      },
      backgroundWeights: {
        ...testAdmission.backgroundWeights,
        'primary-monitoring': 3,
        leaderboard: 1,
      },
    } as const
    const producer = createPostgresRefreshOperations(connectionString)
    await producer.configureAdmission(admission)
    await expect(producer.claim('mismatched-replica', 10_000, testAdmission)).rejects.toThrow(
      'differs from the policy active in PostgreSQL',
    )

    for (let index = 0; index < 2; index += 1) {
      await producer.accept({
        dedupeKey: `bounded:${randomUUID()}`,
        operationKey: `bounded-effect:${randomUUID()}`,
        workClass: 'maintenance',
        payload: { value: `${index}` },
        provenance: { source: 'integration-test' },
      })
    }
    const boundedReplicas = Array.from({ length: 4 }, () => createPostgresRefreshOperations(connectionString))
    const boundedClaims = await Promise.all(
      boundedReplicas.map((replica, index) => replica.claim(`bounded-${index}`, 10_000, admission)),
    )
    const boundedLeases = boundedClaims.filter((lease): lease is OperationLease => lease !== null)
    expect(boundedLeases).toHaveLength(1)
    expect(boundedLeases[0].workClass).toBe('maintenance')
    await Promise.all(boundedReplicas.map((replica) => replica.close()))
    expect(await producer.complete(boundedLeases[0])).toBe('transitioned')
    const boundedNext = requireLease(await producer.claim('bounded-2', 10_000, admission))
    expect(boundedNext.workClass).toBe('maintenance')
    expect(await producer.complete(boundedNext)).toBe('transitioned')

    for (const workClass of ['primary-monitoring', 'leaderboard'] as const) {
      for (let index = 0; index < 16; index += 1) {
        await producer.accept({
          dedupeKey: `weighted:${workClass}:${randomUUID()}`,
          operationKey: `weighted-effect:${workClass}:${randomUUID()}`,
          workClass,
          payload: { value: `${workClass}-${index}` },
          provenance: { source: 'integration-test' },
        })
      }
    }
    await producer.close()

    const sequence: string[] = []
    for (let replicaNumber = 0; replicaNumber < 2; replicaNumber += 1) {
      const replica = createPostgresRefreshOperations(connectionString)
      for (let index = 0; index < 8; index += 1) {
        const lease = requireLease(await replica.claim(`replica-${replicaNumber}`, 10_000, admission))
        sequence.push(lease.workClass)
        expect(await replica.complete(lease)).toBe('transitioned')
      }
      await replica.close()
    }
    expect(sequence).toEqual(
      Array.from({ length: 4 }, () => [
        'primary-monitoring',
        'primary-monitoring',
        'leaderboard',
        'primary-monitoring',
      ]).flat(),
    )

    const cleanup = createPostgresRefreshOperations(connectionString)
    for (;;) {
      const lease = await cleanup.claim('weighted-cleanup', 10_000, admission)
      if (!lease) break
      expect(await cleanup.complete(lease)).toBe('transitioned')
    }
    await cleanup.close()
  })
})
