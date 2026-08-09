import { hostname } from 'node:os'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { readOperationsWorkerConfig } from './operations-worker-config'
import { runOneProofOperation } from './refresh-operations-worker'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const operations = createPostgresRefreshOperations(connectionString)
const workerId = `${hostname()}:${process.pid}`
const config = readOperationsWorkerConfig(process.env)
const shutdown = new AbortController()
const waiters = new Set<() => void>()

function wakeAll() {
  for (const wake of [...waiters]) wake()
}

function waitForWake() {
  if (shutdown.signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      waiters.delete(done)
      shutdown.signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, config.pollMs)
    waiters.add(done)
    shutdown.signal.addEventListener('abort', done, { once: true })
  })
}

async function scheduleLoop() {
  while (!shutdown.signal.aborted) {
    const result = await operations.materializeDueSchedules(config.scheduleBatchSize)
    if (result.occurrencesCreated === 0) await waitForWake()
  }
}

async function operationLoop(slot: number) {
  while (!shutdown.signal.aborted) {
    const processed = await runOneProofOperation(operations, `${workerId}:${slot}`, {
      leaseMs: config.leaseMs,
      retryDelayMs: config.retryDelayMs,
      admission: config.admission,
    })
    if (!processed) await waitForWake()
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown.abort()
    wakeAll()
  })
}

await operations.configureAdmission(config.admission)
const listener = await operations.listen(wakeAll)
try {
  const loops = [
    scheduleLoop(),
    ...Array.from({ length: config.admission.totalConcurrency }, (_, slot) => operationLoop(slot)),
  ].map((loop) =>
    loop.catch((error) => {
      shutdown.abort()
      wakeAll()
      throw error
    }),
  )
  const results = await Promise.allSettled(loops)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
} finally {
  await listener.unlisten()
  await operations.close()
}
