import { hostname } from 'node:os'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import { Hono } from 'hono'
import { createHealthRoutes } from './health-routes'
import { readOperationsWorkerConfig } from './operations-worker-config'
import { runOperationsWorker } from './operations-worker-runtime'
import { createPostgresReadiness } from './postgres-readiness'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const workerConfig = readOperationsWorkerConfig(process.env)
const operations = createPostgresRefreshOperations(connectionString, {
  executionConcurrency: workerConfig.admission.totalConcurrency,
})
const postgresReadiness = createPostgresReadiness(connectionString, refreshOperationsMigrationInventory)
const workerId = `${hostname()}:${process.pid}`
const runtimeConfig = readRuntimeConfig(process.env)
let listener: Awaited<ReturnType<typeof operations.listen>> | undefined
const healthServer = { current: undefined as ReturnType<typeof Bun.serve> | undefined }

const lifecycle = createRuntimeLifecycle({
  ...runtimeConfig,
  readinessProbes: [{ name: 'postgres-schema', check: postgresReadiness.check }],
  closers: [
    {
      name: 'health-server',
      close: async () => {
        await healthServer.current?.stop(true)
      },
    },
    {
      name: 'postgres-listener',
      close: async () => {
        await listener?.unlisten()
      },
    },
    { name: 'operations-postgres', close: operations.close },
    { name: 'readiness-postgres', close: postgresReadiness.close },
  ],
})

const health = new Hono()
health.route('/health', createHealthRoutes(lifecycle))
healthServer.current = Bun.serve({ port: readHealthPort(process.env.HEALTH_PORT, 3001), fetch: health.fetch })
lifecycle.markReady()

let shutdownRequested = false
function requestShutdown(): void {
  if (shutdownRequested) return
  shutdownRequested = true
  lifecycle.beginShutdown()
  void lifecycle.shutdown().then(({ drained, cleanupCompleted, errors }) => {
    if (!drained || !cleanupCompleted) process.exit(1)
    if (errors.length > 0) process.exitCode = 1
  })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, requestShutdown)

try {
  await runOperationsWorker({
    operations,
    lifecycle,
    workerId,
    config: workerConfig,
    ensureListener: async (onWakeup) => {
      listener ??= await operations.listen(onWakeup)
    },
  })
} catch (error) {
  console.error('[operations-worker] fatal runtime failure', error)
  process.exitCode = 1
} finally {
  requestShutdown()
  const result = await lifecycle.shutdown()
  if (!result.drained || !result.cleanupCompleted || result.errors.length > 0) process.exitCode = 1
}
