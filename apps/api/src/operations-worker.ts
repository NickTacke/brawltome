import { hostname } from 'node:os'
import { BhApiClient } from '@brawltome/bhapi'
import { processRefreshClanSection } from '@brawltome/clan'
import { createPostgresClans } from '@brawltome/clan/composition'
import { closeDatabase, db } from '@brawltome/database'
import { createLegendReferenceIndex, legendSlug, normalizeWeaponName } from '@brawltome/game-data'
import {
  createPlayerRepo,
  createPostgresCareerPlayers,
  createPostgresRankedPlayers,
  refreshCanonicalCareerPlayer,
  refreshCanonicalRankedPlayer,
} from '@brawltome/player/composition'
import { createPostgresRanking, fetchLeaderboardPage } from '@brawltome/ranking/composition'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { createPostgresRequestAdmission } from '@brawltome/request-admission/composition'
import { Hono } from 'hono'
import { createHealthRoutes } from './health-routes'
import { leaderboardScheduleDefinitions, readOperationsWorkerConfig } from './operations-worker-config'
import { runOperationsWorker } from './operations-worker-runtime'
import { createPostgresReadiness } from './postgres-readiness'
import { reconcileInteractiveAdmissions, runOneRefreshOperation } from './refresh-operations-worker'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { runtimeMigrationInventory } from './runtime-migration-inventory'

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
const ranking = createPostgresRanking(connectionString)
const careerPlayers = createPostgresCareerPlayers(connectionString)
const rankedPlayers = createPostgresRankedPlayers(connectionString, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayers.mainLegendById(brawlhallaId),
})
const clans = createPostgresClans(connectionString)
const postgresReadiness = createPostgresReadiness(connectionString, runtimeMigrationInventory)
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
    { name: 'players-ranked-postgres', close: rankedPlayers.close },
    { name: 'players-career-postgres', close: careerPlayers.close },
    { name: 'database-postgres', close: closeDatabase },
    { name: 'operations-postgres', close: operations.close },
    { name: 'ranking-postgres', close: ranking.close },
    { name: 'clans-postgres', close: clans.close },
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

const leaderboardSchedules = leaderboardScheduleDefinitions(workerConfig.leaderboard)
let leaderboardSchedulesReconciled = false
try {
  await runOperationsWorker({
    operations,
    lifecycle,
    workerId,
    config: workerConfig,
    reconcile: async () => {
      const interactiveAdmissions = await reconcileInteractiveAdmissions(operations, requestAdmission)
      if (leaderboardSchedulesReconciled) return interactiveAdmissions
      let reconciled = 0
      for (const definition of leaderboardSchedules) {
        const schedule = await operations.reconcileLeaderboardSchedule(definition)
        if (schedule.outcome !== 'already-exists') reconciled++
      }
      leaderboardSchedulesReconciled = true
      return interactiveAdmissions + reconciled
    },
    ensureListener: async (onWakeup) => {
      listener ??= await operations.listen(onWakeup)
    },
    runOne: (repository, slotWorkerId, common) =>
      runOneRefreshOperation(repository, slotWorkerId, {
        ...common,
        sourceAdmission: requestAdmission,
        ranking,
        leaderboardSource: { fetchPage: fetchLeaderboardPage },
        executeSection: async (lease, section, admitSourceCall) => {
          await playerRepo.createPlaceholder(lease.payload.brawlhallaId)
          const admittedBhapi = new BhApiClient({
            apiKey,
            beforeRequest: ({ domain }) => admitSourceCall(domain),
          })
          if (section === 'ranked') {
            await refreshCanonicalRankedPlayer(
              rankedPlayers,
              { getRanked: (brawlhallaId, options) => admittedBhapi.getPlayerRanked(brawlhallaId, options) },
              lease.payload.brawlhallaId,
              { caller: 'on-demand' },
              {
                operationId: lease.operationId,
                effectOperationId: lease.effectOperationId,
                leaseOwner: lease.leaseOwner,
                leaseToken: lease.leaseToken,
                section: 'ranked',
              },
            )
          } else {
            const legendRecords = await db.query.legend.findMany()
            const references = createLegendReferenceIndex(
              legendRecords.map((legend) => ({
                legendId: legend.legendId,
                legendNameKey: legendSlug(legend.legendId, legend.legendNameKey),
                bioName: legend.bioName,
                weaponOne: legend.weaponOne,
                weaponTwo: legend.weaponTwo,
              })),
            )
            await refreshCanonicalCareerPlayer(
              careerPlayers,
              { getStats: (brawlhallaId, options) => admittedBhapi.getPlayerStats(brawlhallaId, options) },
              lease.payload.brawlhallaId,
              { caller: 'on-demand' },
              {
                operationId: lease.operationId,
                effectOperationId: lease.effectOperationId,
                leaseOwner: lease.leaseOwner,
                leaseToken: lease.leaseToken,
                section: 'stats',
              },
              (legendId, legendNameKey) => {
                const byId = references.getById(legendId)
                const byKey = references.getByKey(legendNameKey)
                if (!byId || !byKey || byId.legendId !== byKey.legendId || byId.legendNameKey !== byKey.legendNameKey) {
                  return null
                }
                return {
                  legendId: byId.legendId,
                  legendNameKey: byId.legendNameKey,
                  weaponOne: normalizeWeaponName(byId.weaponOne),
                  weaponTwo: normalizeWeaponName(byId.weaponTwo),
                }
              },
            )
          }
        },
        syncClanLeaseAuthority: async (lease, section, leaseExpiresAt) => {
          const prepared = await clans.prepareRefreshEffect({
            operationId: lease.effectOperationId,
            section,
            leaseToken: lease.leaseToken,
            leaseExpiresAt,
          })
          if (prepared === 'fenced') throw new Error(`${section} refresh lease was fenced`)
        },
        revokeClanLeaseAuthority: (lease, section) =>
          clans.revokeRefreshEffect({
            operationId: lease.effectOperationId,
            section,
            leaseToken: lease.leaseToken,
            leaseExpiresAt: new Date(0),
          }),
        executeClanSection: async (lease, section, admitSourceCall, leaseExpiresAt) => {
          const admittedBhapi = new BhApiClient({ apiKey, beforeRequest: ({ domain }) => admitSourceCall(domain) })
          const result = await processRefreshClanSection(
            clans,
            admittedBhapi,
            lease.payload.clanId,
            section,
            'on-demand',
            new Date(),
            { operationId: lease.effectOperationId, section, leaseToken: lease.leaseToken, leaseExpiresAt },
          )
          if (result.outcome === 'preserved') throw new Error(result.error ?? `${section} refresh failed`)
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
