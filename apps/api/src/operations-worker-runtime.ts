import type { AdmissionConfig } from '@brawltome/refresh-operations'
import type { PostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { runOneProofOperation } from './refresh-operations-worker'
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
  runOne?: typeof runOneProofOperation
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

export async function runOperationsWorker({
  operations,
  lifecycle,
  workerId,
  config,
  logger = console,
  ensureListener,
  runOne = runOneProofOperation,
}: OperationsWorkerDependencies): Promise<void> {
  const wakeup = createWakeupWaiter(config.pollMs, lifecycle.signal)
  let admissionInitialization: Promise<void> | undefined
  let listenerInitialization: Promise<void> | undefined
  let listenerReady = false

  async function ensureWakeupListener(): Promise<void> {
    if (!ensureListener || listenerReady) return
    listenerInitialization ??= ensureListener(wakeup.wakeAll)
    try {
      await listenerInitialization
      listenerReady = true
    } catch (error) {
      listenerInitialization = undefined
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
      logger.error('[operations-worker] admission initialization failed; retrying by poll', error)
      await wakeup.wait()
      return false
    }
    await ensureWakeupListener()
    return true
  }

  async function runTracked(work: () => Promise<boolean>): Promise<boolean | null> {
    const finishWork = lifecycle.startWork()
    if (!finishWork) return null
    try {
      return await work()
    } catch (error) {
      logger.error('[operations-worker] claim or execution failed; retrying by poll', error)
      return false
    } finally {
      finishWork()
    }
  }

  async function scheduleLoop(): Promise<void> {
    while (!lifecycle.signal.aborted) {
      if (!(await prepare())) continue
      const created = await runTracked(async () => {
        const result = await operations.materializeDueSchedules(config.scheduleBatchSize)
        return result.occurrencesCreated > 0
      })
      if (created === null) return
      if (!created) await wakeup.wait()
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
