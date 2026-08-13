import type { AdmissionConfig } from '@brawltome/refresh-operations'
import type { PostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import type { Telemetry } from '@brawltome/telemetry'
import { runOneRefreshOperation } from './refresh-operations-worker'
import type { RuntimeLifecycle } from './runtime-lifecycle'

type WorkerConfig = {
  leaseMs: number
  pollMs: number
  retryDelayMs: number
  scheduleBatchSize: number
  admission: AdmissionConfig
}

type WorkerLogger = Pick<Console, 'error'>

type OperationsWorkerDependencies = {
  operations: PostgresRefreshOperations
  lifecycle: RuntimeLifecycle
  workerId: string
  config: WorkerConfig
  logger?: WorkerLogger
  ensureListener?: (onWakeup: () => void) => Promise<void>
  reconcile?: () => Promise<number>
  runOne?: typeof runOneRefreshOperation
  telemetry?: Telemetry
  telemetryIntervalMs?: number
  telemetryTimeoutMs?: number
}

function createWakeupWaiter(intervalMs: number, signal: AbortSignal) {
  const waiters = new Set<() => void>()

  function wakeAll(): void {
    for (const wake of [...waiters]) wake()
  }

  function wait(): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, intervalMs)
      waiters.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  return { wait, wakeAll }
}

export function createOperationsTelemetryObserver(options: {
  operations: Pick<PostgresRefreshOperations, 'inspectTelemetry'>
  telemetry: Telemetry
  intervalMs: number
  timeoutMs: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let nextTelemetryAt = 0
  let inspection: Promise<unknown> | undefined

  function record(recording: (active: Telemetry) => void): void {
    try {
      recording(options.telemetry)
    } catch {
      return
    }
  }

  function apply(snapshot: Awaited<ReturnType<PostgresRefreshOperations['inspectTelemetry']>>): void {
    for (const item of snapshot.oldestPending) {
      record((active) =>
        active.metrics.set('operation_oldest_pending_age_ms', item.ageMs, { work_class: item.workClass }),
      )
    }
    for (const item of snapshot.deadLetters) {
      record((active) =>
        active.metrics.set('operation_dead_letters', item.count, { work_class: item.workClass, kind: item.kind }),
      )
    }
    for (const item of snapshot.scheduleLateness) {
      record((active) => active.metrics.set('schedule_lateness_ms', item.latenessMs, { kind: item.kind }))
    }
  }

  function trigger(): void {
    if (inspection || now() < nextTelemetryAt) return
    nextTelemetryAt = now() + options.intervalMs
    const underlying = Promise.resolve().then(() => options.operations.inspectTelemetry())
    inspection = underlying
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        inspection = undefined
      })
    void Promise.race([
      underlying.then((snapshot) => ({ kind: 'snapshot' as const, snapshot })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), Math.max(1, options.timeoutMs)),
      ),
    ])
      .then((result) => {
        if (result.kind === 'snapshot') apply(result.snapshot)
        else record((active) => active.logger.warn('worker.measurements.timed_out'))
      })
      .catch((error) => record((active) => active.logger.error('worker.measurements.failed', error)))
  }

  return { trigger }
}

export async function runOperationsWorker({
  operations,
  lifecycle,
  workerId,
  config,
  logger = console,
  ensureListener,
  reconcile,
  runOne = runOneRefreshOperation,
  telemetry,
  telemetryIntervalMs = 5_000,
  telemetryTimeoutMs = 250,
}: OperationsWorkerDependencies): Promise<void> {
  const wakeup = createWakeupWaiter(config.pollMs, lifecycle.signal)
  let admissionInitialization: Promise<void> | undefined
  let listenerInitialization: Promise<void> | undefined
  let listenerReady = false
  const telemetryObserver =
    telemetry && 'inspectTelemetry' in operations
      ? createOperationsTelemetryObserver({
          operations,
          telemetry,
          intervalMs: telemetryIntervalMs,
          timeoutMs: telemetryTimeoutMs,
        })
      : undefined

  function recordTelemetry(recording: (active: Telemetry) => void): void {
    if (!telemetry) return
    try {
      recording(telemetry)
    } catch {
      return
    }
  }

  function heartbeat(): void {
    recordTelemetry((active) =>
      active.metrics.set('worker_heartbeat_timestamp_seconds', Date.now() / 1_000, {
        runtime: 'operations-worker',
      }),
    )
  }

  async function ensureWakeupListener(): Promise<void> {
    if (!ensureListener || listenerReady) return
    listenerInitialization ??= ensureListener(wakeup.wakeAll)
    try {
      await listenerInitialization
      listenerReady = true
    } catch (error) {
      listenerInitialization = undefined
      recordTelemetry((active) => active.logger.error('worker.listener.failed', error))
      logger.error('[operations-worker] PostgreSQL listener unavailable; polling remains active', error)
    }
  }

  async function prepare(): Promise<boolean> {
    const readiness = await lifecycle.readiness()
    if (!readiness.ready) {
      if (readiness.reason === 'dependency') await wakeup.wait()
      return false
    }

    admissionInitialization ??= operations.configureAdmission(config.admission)
    try {
      await admissionInitialization
    } catch (error) {
      admissionInitialization = undefined
      recordTelemetry((active) => active.logger.error('worker.admission.failed', error))
      logger.error('[operations-worker] admission initialization failed; retrying by poll', error)
      await wakeup.wait()
      return false
    }
    await ensureWakeupListener()
    heartbeat()
    telemetryObserver?.trigger()
    return true
  }

  async function runTracked(work: () => Promise<boolean>): Promise<boolean | null> {
    const finishWork = lifecycle.startWork()
    if (!finishWork) return null
    try {
      return await work()
    } catch (error) {
      recordTelemetry((active) => active.logger.error('worker.loop.failed', error))
      logger.error('[operations-worker] claim or execution failed; retrying by poll', error)
      return false
    } finally {
      finishWork()
    }
  }

  async function scheduleLoop(): Promise<void> {
    while (!lifecycle.signal.aborted) {
      if (!(await prepare())) continue
      const active = await runTracked(async () => {
        const reconciled = !lifecycle.signal.aborted && reconcile ? await reconcile() : 0
        if (lifecycle.signal.aborted) return reconciled > 0
        let result: Awaited<ReturnType<PostgresRefreshOperations['materializeDueSchedules']>>
        try {
          result = await operations.materializeDueSchedules(config.scheduleBatchSize)
        } catch (error) {
          recordTelemetry((active) => active.metrics.add('schedule_materializations_total', 1, { outcome: 'failed' }))
          throw error
        }
        recordTelemetry((active) => {
          active.metrics.add('schedule_materializations_total', Math.max(1, result.occurrencesCreated), {
            outcome: result.occurrencesCreated > 0 ? 'created' : 'idle',
          })
          for (const occurrence of result.occurrences) {
            active.metrics.set('schedule_lateness_ms', occurrence.latenessMs, { kind: occurrence.kind })
            if (occurrence.missedWindowCount > 0) {
              active.metrics.add('schedule_missed_windows_total', occurrence.missedWindowCount, {
                kind: occurrence.kind,
              })
            }
            active.logger.info('schedule.materialized', {
              scheduleId: occurrence.scheduleId,
              occurrenceId: occurrence.occurrenceId,
              operationId: occurrence.operationId,
              kind: occurrence.kind,
              workClass: occurrence.workClass,
              latenessMs: occurrence.latenessMs,
              missedWindowCount: occurrence.missedWindowCount,
            })
          }
        })
        return result.occurrencesCreated > 0 || reconciled > 0
      })
      if (active === null) return
      if (!active) await wakeup.wait()
    }
  }

  async function operationLoop(slot: number): Promise<void> {
    while (!lifecycle.signal.aborted) {
      if (!(await prepare())) continue
      const processed = await runTracked(() =>
        runOne(operations, `${workerId}:${slot}`, {
          leaseMs: config.leaseMs,
          retryDelayMs: config.retryDelayMs,
          admission: config.admission,
          telemetry,
        }),
      )
      if (processed === null) return
      if (!processed) await wakeup.wait()
    }
  }

  await Promise.all([
    scheduleLoop(),
    ...Array.from({ length: config.admission.totalConcurrency }, (_, slot) => operationLoop(slot)),
  ])
}
