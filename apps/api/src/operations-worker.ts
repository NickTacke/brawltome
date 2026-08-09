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
let wake: (() => void) | undefined

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown.abort()
    wake?.()
  })
}

const listener = await operations.listen(() => wake?.())
try {
  while (!shutdown.signal.aborted) {
    let processed = false
    while (
      !shutdown.signal.aborted &&
      (await runOneProofOperation(operations, workerId, {
        leaseMs: config.leaseMs,
        retryDelayMs: config.retryDelayMs,
      }))
    ) {
      processed = true
    }
    if (shutdown.signal.aborted) break
    if (!processed) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          shutdown.signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, config.pollMs)
        wake = done
        shutdown.signal.addEventListener('abort', done, { once: true })
      })
      wake = undefined
    }
  }
} finally {
  await listener.unlisten()
  await operations.close()
}
