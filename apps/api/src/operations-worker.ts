import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { createPostgresAccounts } from '@brawltome/accounts/composition'
import { BhApiClient, RateLimitError } from '@brawltome/bhapi'
import { processRefreshClanSection } from '@brawltome/clan'
import { createPostgresClanDiscoverySource, createPostgresClans } from '@brawltome/clan/composition'
import { closeDatabase, db } from '@brawltome/database'
import { createPostgresDiscovery } from '@brawltome/discovery/composition'
import { createLegendReferenceIndex, legendSlug, normalizeWeaponName } from '@brawltome/game-data'
import {
  createPlayerRepo,
  createPostgresCareerPlayers,
  createPostgresPlayerDiscoverySource,
  createPostgresRankedPlayers,
  createSteamPlayerEvidenceResolver,
  refreshCanonicalCareerPlayer,
  refreshCanonicalRankedPlayer,
  refreshRankedPlayerPulse,
} from '@brawltome/player/composition'
import { createPostgresRanking, fetchLeaderboardPage } from '@brawltome/ranking/composition'
import { createPostgresRefreshOperations } from '@brawltome/refresh-operations/composition'
import { createPostgresRequestAdmission } from '@brawltome/request-admission/composition'
import { createPostgresStatistics } from '@brawltome/statistics/composition'
import { instrumentHttpHandler, renderPrometheus } from '@brawltome/telemetry'
import { serve } from 'bun'
import { Hono } from 'hono'
import { internalSecretValid } from './auth/internal-secret'
import { createHealthRoutes } from './health-routes'
import { leaderboardScheduleDefinitions, readOperationsWorkerConfig } from './operations-worker-config'
import { runOperationsWorker } from './operations-worker-runtime'
import { createPostgresReadiness } from './postgres-readiness'
import { reconcileInteractiveAdmissions, runOneRefreshOperation } from './refresh-operations-worker'
import { readHealthPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { runtimeMigrationInventory } from './runtime-migration-inventory'
import { reconcileStatisticsCohort } from './statistics-cohort-reconciliation'
import { collectStatisticsEvidence } from './statistics-collection-source'
import { createRuntimeTelemetry } from './telemetry'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const apiKey = process.env.BRAWLHALLA_API_KEY
if (!apiKey) throw new Error('BRAWLHALLA_API_KEY is required')

const telemetry = createRuntimeTelemetry('operations-worker')
const workerConfig = readOperationsWorkerConfig(process.env)
const accounts = createPostgresAccounts(connectionString)
const discovery = createPostgresDiscovery(connectionString)
const operations = createPostgresRefreshOperations(connectionString, {
  executionConcurrency: workerConfig.admission.totalConcurrency,
  playerProjectionEffectState: discovery.playerProjectionEffectState,
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
const statistics = createPostgresStatistics(connectionString)
const careerPlayers = createPostgresCareerPlayers(connectionString)
const rankedPlayers = createPostgresRankedPlayers(connectionString, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayers.mainLegendById(brawlhallaId),
})
const clans = createPostgresClans(connectionString)
const playerDiscoverySource = createPostgresPlayerDiscoverySource(connectionString)
const clanDiscoverySource = createPostgresClanDiscoverySource(connectionString)
const postgresReadiness = createPostgresReadiness(connectionString, runtimeMigrationInventory)
const workerId = `${hostname()}:${process.pid}`
const runtimeConfig = readRuntimeConfig(process.env)
let listener: Awaited<ReturnType<typeof operations.listen>> | undefined
const healthServer = { current: undefined as ReturnType<typeof serve> | undefined }

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
    { name: 'accounts-postgres', close: accounts.close },
    { name: 'players-ranked-postgres', close: rankedPlayers.close },
    { name: 'players-career-postgres', close: careerPlayers.close },
    { name: 'database-postgres', close: closeDatabase },
    { name: 'operations-postgres', close: operations.close },
    { name: 'ranking-postgres', close: ranking.close },
    { name: 'statistics-postgres', close: statistics.close },
    { name: 'clans-postgres', close: clans.close },
    { name: 'discovery-postgres', close: discovery.close },
    { name: 'players-discovery-source-postgres', close: playerDiscoverySource.close },
    { name: 'clans-discovery-source-postgres', close: clanDiscoverySource.close },
    { name: 'readiness-postgres', close: postgresReadiness.close },
    { name: 'telemetry', close: () => telemetry.shutdown(runtimeConfig.cleanupReserveMs) },
  ],
})

const health = new Hono()
health.route('/health', createHealthRoutes(lifecycle))
health.get('/metrics', async (context) => {
  if (!internalSecretValid(context.req.header('x-metrics-secret'), process.env.METRICS_SCRAPE_SECRET)) {
    return context.json({ error: 'unauthorized' }, 401)
  }
  try {
    const quota = await requestAdmission.inspectCurrentUsage()
    for (const item of quota.domains) {
      telemetry.metrics.set('source_quota_used', item.used, { domain: item.domain })
      telemetry.metrics.set('source_quota_limit', item.limit, { domain: item.domain })
    }
  } catch (error) {
    telemetry.logger.error('metrics.measurement.failed', error)
  }
  return context.body(renderPrometheus(telemetry.metrics.snapshot()), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  })
})
const healthFetch = instrumentHttpHandler(telemetry, 'operations-worker', health.fetch)
healthServer.current = serve({ port: readHealthPort(process.env.HEALTH_PORT, 3001), fetch: healthFetch })
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
    telemetry,
    reconcile: async () => {
      const interactiveAdmissions = await reconcileInteractiveAdmissions(operations, requestAdmission)
      const primaryMonitoring = await operations.reconcilePrimaryMonitoring(
        await accounts.primaryMonitoring.readSnapshot(),
      )
      let reconciledDiscovery = 0
      for (const definition of [
        {
          owner: 'player' as const,
          kind: 'player-discovery-projection' as const,
          source: playerDiscoverySource,
        },
        {
          owner: 'clan' as const,
          kind: 'clan-discovery-projection' as const,
          source: clanDiscoverySource,
        },
      ]) {
        if ((await definition.source.lag()) > 0) {
          const projection = await operations.accept({
            kind: definition.kind,
            dedupeKey: `discovery:${definition.owner}:pending`,
            operationKey: `discovery:${definition.owner}:${randomUUID()}`,
            workClass: 'projection',
            payload: { batchSize: workerConfig.discovery.projectionBatchSize },
            provenance: { source: 'projection-delivery', requestedBy: 'issue-200' },
          })
          if (projection.outcome === 'accepted') reconciledDiscovery++
        }
        if (await discovery.reconciliationDue(definition.owner, workerConfig.discovery.reconciliationIntervalMs)) {
          const reconciliation = await operations.accept({
            kind: 'discovery-reconciliation',
            dedupeKey: `discovery:${definition.owner}:reconciliation`,
            operationKey: `discovery:${definition.owner}:reconciliation:${randomUUID()}`,
            workClass: 'projection',
            payload: { owner: definition.owner },
            provenance: { source: 'owner-fact-reconciliation', requestedBy: 'issue-200' },
          })
          if (reconciliation.outcome === 'accepted') reconciledDiscovery++
        }
      }
      const reconciledStatistics = await reconcileStatisticsCohort(statistics, operations, ranking.queries)
      if (leaderboardSchedulesReconciled) {
        return (
          interactiveAdmissions +
          reconciledDiscovery +
          reconciledStatistics +
          primaryMonitoring.created +
          primaryMonitoring.retired
        )
      }
      let reconciledSchedules = 0
      for (const definition of leaderboardSchedules) {
        const schedule = await operations.reconcileLeaderboardSchedule(definition)
        if (schedule.outcome !== 'already-exists') reconciledSchedules++
      }
      leaderboardSchedulesReconciled = true
      return (
        interactiveAdmissions +
        reconciledDiscovery +
        reconciledStatistics +
        reconciledSchedules +
        primaryMonitoring.created +
        primaryMonitoring.retired
      )
    },
    ensureListener: async (onWakeup) => {
      listener ??= await operations.listen(onWakeup)
    },
    runOne: (repository, slotWorkerId, common) =>
      runOneRefreshOperation(repository, slotWorkerId, {
        ...common,
        sourceAdmission: requestAdmission,
        executeEffect: async (lease) => {
          if (!lease.operationKey.startsWith('primary-player:')) return operations.commitProofEffect(lease)
          const admittedBhapi = new BhApiClient({
            apiKey,
            telemetry,
            beforeRequest: async ({ domain }) => {
              const admission = await requestAdmission.admitSource({
                domain,
                reservationKey: `${lease.operationId}:primary-player:${lease.attemptNumber}`,
                units: 1,
              })
              if (admission.outcome === 'rate-limited') {
                throw new RateLimitError(
                  `${domain} PostgreSQL source admission is rate limited`,
                  admission.retryAfterSeconds * 1_000,
                )
              }
            },
          })
          await accounts.accounts.resolvePrimaryPlayerVerification(
            lease.payload.value,
            createSteamPlayerEvidenceResolver(admittedBhapi),
          )
          return operations.commitProofEffect(lease)
        },
        ranking,
        leaderboardSource: { fetchPage: fetchLeaderboardPage },
        statistics,
        executeStatisticsCollection: (lease) =>
          collectStatisticsEvidence(new BhApiClient({ apiKey, telemetry }), lease),
        executePlayerProjection: async (lease) => {
          await discovery.deliverPendingPlayers(
            playerDiscoverySource,
            lease.payload.batchSize,
            lease.effectOperationId,
            () => operations.discoveryLeaseActive(lease),
          )
        },
        executeClanProjection: async (lease) => {
          await discovery.deliverPendingClans(
            clanDiscoverySource,
            lease.payload.batchSize,
            lease.effectOperationId,
            () => operations.discoveryLeaseActive(lease),
          )
        },
        executeDiscoveryReconciliation: async (lease) => {
          if (lease.payload.owner === 'player') {
            await discovery.reconcilePlayers(playerDiscoverySource, lease.effectOperationId, () =>
              operations.discoveryLeaseActive(lease),
            )
          } else {
            await discovery.reconcileClans(clanDiscoverySource, lease.effectOperationId, () =>
              operations.discoveryLeaseActive(lease),
            )
          }
        },
        projectionEffectState: (kind, effectOperationId) =>
          kind === 'player-discovery-projection'
            ? discovery.playerProjectionEffectState(effectOperationId)
            : discovery.clanProjectionEffectState(effectOperationId),
        isPrimaryMonitoringTarget: async (lease) => {
          const snapshot = await accounts.primaryMonitoring.readSnapshot()
          return snapshot.targets.some(
            (target) =>
              target.assignmentId === lease.payload.assignmentId && target.brawlhallaId === lease.payload.brawlhallaId,
          )
        },
        executeSection: async (lease, section, admitSourceCall, caller) => {
          await playerRepo.createPlaceholder(lease.payload.brawlhallaId)
          const admittedBhapi = new BhApiClient({
            apiKey,
            telemetry,
            beforeRequest: async ({ domain }) => {
              if (lease.workClass === 'primary-monitoring') {
                const snapshot = await accounts.primaryMonitoring.readSnapshot()
                const current = snapshot.targets.some(
                  (target) =>
                    target.assignmentId === lease.payload.assignmentId &&
                    target.brawlhallaId === lease.payload.brawlhallaId,
                )
                if (!current) throw new Error('Primary Player assignment is no longer current')
              }
              await admitSourceCall(domain)
            },
          })
          if (section === 'ranked') {
            await refreshCanonicalRankedPlayer(
              rankedPlayers,
              { getRanked: (brawlhallaId, options) => admittedBhapi.getPlayerRanked(brawlhallaId, options) },
              lease.payload.brawlhallaId,
              { caller },
              {
                operationId: lease.operationId,
                effectOperationId: lease.effectOperationId,
                leaseOwner: lease.leaseOwner,
                leaseToken: lease.leaseToken,
                effectCreatedAt: lease.effectCreatedAt,
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
              { caller },
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
        executeRankedPulse: async (lease, admitSourceCall) => {
          const admittedBhapi = new BhApiClient({
            apiKey,
            telemetry,
            beforeRequest: ({ domain }) => admitSourceCall(domain),
          })
          await refreshRankedPlayerPulse(
            rankedPlayers,
            {
              getOneVsOne: (brawlhallaId, options) =>
                admittedBhapi.getPlayerStatsV1Payload(brawlhallaId, 'ranked_1v1', options),
              getFixedTeams: (brawlhallaId, options) => admittedBhapi.getPlayerTeamsV1Payload(brawlhallaId, options),
            },
            lease.payload.brawlhallaId,
            { caller: 'background' },
            {
              operationId: lease.operationId,
              effectOperationId: lease.effectOperationId,
              leaseOwner: lease.leaseOwner,
              leaseToken: lease.leaseToken,
              effectCreatedAt: lease.effectCreatedAt,
              section: 'ranked',
            },
          )
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
          const admittedBhapi = new BhApiClient({
            apiKey,
            telemetry,
            beforeRequest: ({ domain }) => admitSourceCall(domain),
          })
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
  telemetry.logger.error('operations_worker.fatal', error)
  process.exitCode = 1
} finally {
  requestShutdown()
  const result = await lifecycle.shutdown()
  if (!result.drained || !result.cleanupCompleted || result.errors.length > 0) process.exitCode = 1
}
