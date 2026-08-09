import { hostname } from 'node:os'
import { BhApiClient } from '@brawltome/bhapi'
import { closeDatabase, db } from '@brawltome/database'
import {
  createPlayerRepo,
  playerMigrationInventory,
  processRefreshRanked,
  processRefreshStats,
} from '@brawltome/player/composition'
import {
  createPostgresRefreshOperations,
  refreshOperationsMigrationInventory,
} from '@brawltome/refresh-operations/composition'
import {
  createPostgresRequestAdmission,
  requestAdmissionMigrationInventory,
} from '@brawltome/request-admission/composition'
import { Hono } from 'hono'
import { createHealthRoutes } from './health-routes'
import { readOperationsWorkerConfig } from './operations-worker-config'
import { runOperationsWorker } from './operations-worker-runtime'
import { createPostgresReadiness } from './postgres-readiness'
import { reconcileInteractiveAdmissions, runOneRefreshOperation } from './refresh-operations-worker'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) throw new Error('BRAWLHALLA_API_KEY is required')

const workerConfig = readOperationsWorkerConfig(process.env)
const operations = createPostgresRefreshOperations(connectionString, {
  executionConcurrency: workerConfig.admission.totalConcurrency,
})
const requestAdmission = createPostgresRequestAdmission(connectionString, {
  authenticatedIpLimit: Number(process.env.AUTHENTICATED_REFRESH_IP_LIMIT ?? 120),
  sourceLimits: {
    'brawlhalla-v0': 180,
    'brawlhalla-v1': Number(process.env.BRAWLHALLA_V1_REQUEST_LIMIT ?? 180),
  },
})
const playerRepo = createPlayerRepo(db)
const postgresReadiness = createPostgresReadiness(connectionString, [
  ...playerMigrationInventory,
  ...refreshOperationsMigrationInventory,
  ...requestAdmissionMigrationInventory,
])
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
    { name: 'request-admission-postgres', close: requestAdmission.close },
    { name: 'database-postgres', close: closeDatabase },
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
    reconcile: () => reconcileInteractiveAdmissions(operations, requestAdmission),
    ensureListener: async (onWakeup) => {
      listener ??= await operations.listen(onWakeup)
    },
    runOne: (repository, slotWorkerId, common) =>
      runOneRefreshOperation(repository, slotWorkerId, {
        ...common,
        sourceAdmission: requestAdmission,
        executeSection: async (lease, section, admitSourceCall) => {
          await playerRepo.createPlaceholder(lease.payload.brawlhallaId)
          const admittedBhapi = new BhApiClient({
            apiKey,
            beforeRequest: ({ domain }) => admitSourceCall(domain),
          })
          const effect = { operationId: lease.operationId, section, leaseToken: lease.leaseToken }
          if (section === 'ranked') {
            await processRefreshRanked({ db, bhapi: admittedBhapi }, lease.payload.brawlhallaId, 'on-demand', effect)
          } else {
            await processRefreshStats({ db, bhapi: admittedBhapi }, lease.payload.brawlhallaId, 'on-demand', effect)
          }
        },
      }),
  })
} catch (error) {
  console.error('[operations-worker] fatal runtime failure', error)
  process.exitCode = 1
} finally {
  requestShutdown()
  const result = await lifecycle.shutdown()
  if (!result.drained || !result.cleanupCompleted || result.errors.length > 0) process.exitCode = 1
}
