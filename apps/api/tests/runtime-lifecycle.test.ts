import { describe, expect, test } from 'bun:test'
import { createTelemetry } from '@brawltome/telemetry'
import { createHealthRoutes } from '../src/health-routes'
import { runOperationsWorker } from '../src/operations-worker-runtime'
import { assertKnownSchemaPrefix } from '../src/postgres-readiness'
import { createRuntimeLifecycle } from '../src/runtime-lifecycle'

const testAdmission = {
  totalConcurrency: 1,
  interactiveReservation: 0,
  classConcurrency: {
    interactive: 1,
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

describe('runtime lifecycle', () => {
  test('separates process liveness from dependency and lifecycle readiness', async () => {
    let databaseAvailable = false
    const lifecycle = createRuntimeLifecycle({
      shutdownDeadlineMs: 100,
      readinessProbes: [
        {
          name: 'postgres-schema',
          check: async () => {
            if (!databaseAvailable) throw new Error('unavailable')
          },
        },
      ],
    })
    const health = createHealthRoutes(lifecycle)

    expect((await health.request('/live')).status).toBe(200)
    expect((await health.request('/ready')).status).toBe(503)
    lifecycle.markReady()
    expect(await (await health.request('/ready')).json()).toEqual({
      status: 'unready',
      reason: 'dependency',
      dependency: 'postgres-schema',
    })

    databaseAvailable = true
    expect((await health.request('/ready')).status).toBe(200)
    lifecycle.beginShutdown()
    expect((await health.request('/live')).status).toBe(200)
    expect(await (await health.request('/ready')).json()).toEqual({ status: 'unready', reason: 'draining' })
  })

  test('synchronously stops admission and drains active work before bounded cleanup', async () => {
    const events: string[] = []
    let finishWork: (() => void) | undefined
    const lifecycle = createRuntimeLifecycle({
      shutdownDeadlineMs: 100,
      cleanupReserveMs: 25,
      stopAdmission: () => events.push('admission-stopped'),
      closers: [
        {
          name: 'telemetry',
          close: async () => {
            events.push('telemetry-closed')
          },
        },
      ],
    })
    lifecycle.markReady()
    const release = lifecycle.startWork()
    if (!release) throw new Error('work should be accepted')
    const work = new Promise<void>((resolve) => {
      finishWork = () => {
        events.push('work-finished')
        release()
        resolve()
      }
    })

    const shutdown = lifecycle.shutdown()
    expect(events).toEqual(['admission-stopped'])
    expect(lifecycle.startWork()).toBeNull()
    finishWork?.()
    await work

    expect(await shutdown).toEqual({ drained: true, cleanupCompleted: true, errors: [] })
    expect(events).toEqual(['admission-stopped', 'work-finished', 'telemetry-closed'])
    expect(lifecycle.state).toBe('stopped')
  })

  test('bounds drain time and still attempts cleanup', async () => {
    let closed = false
    const lifecycle = createRuntimeLifecycle({
      shutdownDeadlineMs: 200,
      cleanupReserveMs: 50,
      closers: [
        {
          name: 'connection',
          close: async () => {
            closed = true
          },
        },
      ],
    })
    lifecycle.markReady()
    expect(lifecycle.startWork()).not.toBeNull()

    expect(await lifecycle.shutdown()).toMatchObject({ drained: false, cleanupCompleted: true })
    expect(closed).toBe(true)
  })

  test('does not become ready when shutdown begins during an asynchronous probe', async () => {
    let finishProbe: (() => void) | undefined
    const lifecycle = createRuntimeLifecycle({
      shutdownDeadlineMs: 100,
      readinessProbes: [
        {
          name: 'postgres-schema',
          check: () =>
            new Promise<void>((resolve) => {
              finishProbe = resolve
            }),
        },
      ],
    })
    lifecycle.markReady()
    const readiness = lifecycle.readiness()
    lifecycle.beginShutdown()
    finishProbe?.()
    expect(await readiness).toEqual({ ready: false, reason: 'draining' })
  })

  test('operations worker stops new claims and drains the active claim', async () => {
    const lifecycle = createRuntimeLifecycle({ shutdownDeadlineMs: 100, cleanupReserveMs: 20 })
    lifecycle.markReady()
    let claims = 0
    let finishClaim: (() => void) | undefined
    const activeClaim = new Promise<void>((resolve) => {
      finishClaim = resolve
    })
    const worker = runOperationsWorker({
      operations: {
        configureAdmission: async () => undefined,
        materializeDueSchedules: async () => ({ occurrencesCreated: 0 }),
      } as never,
      lifecycle,
      workerId: 'test-worker',
      config: {
        leaseMs: 30,
        pollMs: 1,
        retryDelayMs: 1,
        scheduleBatchSize: 1,
        admission: testAdmission,
      },
      runOne: async () => {
        claims++
        await activeClaim
        return true
      },
    })

    await Bun.sleep(1)
    const shutdown = lifecycle.shutdown()
    expect(claims).toBe(1)
    finishClaim?.()
    await worker
    expect(await shutdown).toMatchObject({ drained: true, cleanupCompleted: true })
    expect(claims).toBe(1)
  })

  test('tracks reconciliation through drain and starts none after shutdown', async () => {
    const lifecycle = createRuntimeLifecycle({ shutdownDeadlineMs: 200, cleanupReserveMs: 40 })
    lifecycle.markReady()
    let reconciliations = 0
    let startReconciliation: (() => void) | undefined
    let finishReconciliation: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      startReconciliation = resolve
    })
    const activeReconciliation = new Promise<void>((resolve) => {
      finishReconciliation = resolve
    })
    const worker = runOperationsWorker({
      operations: {
        configureAdmission: async () => undefined,
        materializeDueSchedules: async () => ({ occurrencesCreated: 0 }),
      } as never,
      lifecycle,
      workerId: 'reconciliation-worker',
      config: {
        leaseMs: 30,
        pollMs: 1,
        retryDelayMs: 1,
        scheduleBatchSize: 1,
        admission: testAdmission,
      },
      reconcile: async () => {
        reconciliations++
        startReconciliation?.()
        await activeReconciliation
        return 0
      },
      runOne: async () => false,
    })

    await started
    let shutdownSettled = false
    const shutdown = lifecycle.shutdown().then((result) => {
      shutdownSettled = true
      return result
    })
    await Bun.sleep(5)
    expect(shutdownSettled).toBe(false)
    expect(reconciliations).toBe(1)
    finishReconciliation?.()
    await worker
    expect(await shutdown).toMatchObject({ drained: true, cleanupCompleted: true })
    expect(reconciliations).toBe(1)
  })

  test('records a failed schedule materialization before generic loop handling', async () => {
    const lifecycle = createRuntimeLifecycle({ shutdownDeadlineMs: 100, cleanupReserveMs: 20 })
    const telemetry = createTelemetry({ service: 'operations-worker', drainIntervalMs: 0 })
    lifecycle.markReady()

    await runOperationsWorker({
      operations: {
        configureAdmission: async () => undefined,
        materializeDueSchedules: async () => {
          lifecycle.beginShutdown()
          throw new Error('materialization failed')
        },
      } as never,
      lifecycle,
      workerId: 'failing-materialization-worker',
      config: {
        leaseMs: 30,
        pollMs: 1,
        retryDelayMs: 1,
        scheduleBatchSize: 1,
        admission: testAdmission,
      },
      logger: { error: () => undefined },
      runOne: async () => false,
      telemetry,
    })

    const metric = telemetry.metrics.snapshot().find(({ name }) => name === 'schedule_materializations_total')
    expect(metric?.series).toContainEqual({ labels: { outcome: 'failed' }, value: 1 })
  })

  test('polls for work when PostgreSQL listener registration fails', async () => {
    const lifecycle = createRuntimeLifecycle({ shutdownDeadlineMs: 100, cleanupReserveMs: 20 })
    lifecycle.markReady()
    let claims = 0
    let listenerAttempts = 0
    let materializations = 0

    await runOperationsWorker({
      operations: {
        configureAdmission: async () => undefined,
        materializeDueSchedules: async () => {
          materializations++
          return { occurrencesCreated: 0 }
        },
      } as never,
      lifecycle,
      workerId: 'polling-worker',
      config: {
        leaseMs: 30,
        pollMs: 1,
        retryDelayMs: 1,
        scheduleBatchSize: 1,
        admission: testAdmission,
      },
      ensureListener: async () => {
        listenerAttempts++
        throw new Error('listener unavailable')
      },
      logger: { error: () => undefined },
      runOne: async () => {
        claims++
        lifecycle.beginShutdown()
        return false
      },
    })

    expect(listenerAttempts).toBeGreaterThan(0)
    expect(materializations).toBeGreaterThan(0)
    expect(claims).toBe(1)
  })
})

describe('schema compatibility', () => {
  const expected = [
    { identity: 'players/0001', checksum: 'aaa' },
    { identity: 'refresh-operations/0001', checksum: 'bbb' },
  ]

  test('accepts an exact known prefix while rejecting missing or mutated history', () => {
    expect(() => assertKnownSchemaPrefix(expected, expected)).not.toThrow()
    expect(() =>
      assertKnownSchemaPrefix(expected, [...expected, { identity: 'players/0002', checksum: 'x' }]),
    ).not.toThrow()
    expect(() => assertKnownSchemaPrefix(expected, expected.slice(0, 1))).toThrow('count mismatch')
    expect(() => assertKnownSchemaPrefix(expected, [...expected].reverse())).toThrow('migration mismatch')
    expect(() => assertKnownSchemaPrefix(expected, [expected[0], { ...expected[1], checksum: 'changed' }])).toThrow(
      'checksum mismatch',
    )
  })
})
