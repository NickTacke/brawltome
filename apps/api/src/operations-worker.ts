import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { createPostgresAccounts } from '@brawltome/accounts'
import {
  BhApiClient,
  type BhApiClientOptions,
  brawlhallaV0RequestLimit,
  createBhApiRequestQueue,
} from '@brawltome/bhapi'
import { createPostgresClanDiscoverySource, createPostgresClans, processRefreshClanSection } from '@brawltome/clan'
import { createPostgresDiscovery } from '@brawltome/discovery'
import { checkModuleList } from '@brawltome/foundation'
import { createLegendReferenceIndex, legendSlug, legends, normalizeWeaponName } from '@brawltome/game-data'
import {
  createPostgresCareerPlayers,
  createPostgresLeaderboardPlayerNames,
  createPostgresLeaderboardRanked,
  createPostgresPlayerDiscoverySource,
  createPostgresPlayerFreshness,
  createPostgresPlayerNameVerifications,
  createPostgresProfileViews,
  createPostgresRankedPlayers,
  createSteamPlayerEvidenceResolver,
  refreshCanonicalCareerPlayer,
  refreshCanonicalRankedPlayer,
  refreshRankedPlayerPulse,
} from '@brawltome/player'
import { createPostgresRanking, fetchLeaderboardPage } from '@brawltome/ranking'
import { createPostgresRefreshOperations, SourceAdmissionLimitedError } from '@brawltome/refresh-operations'
import { createPostgresRequestAdmission } from '@brawltome/request-admission'
import { createPostgresStatistics } from '@brawltome/statistics'
import { instrumentHttpHandler, renderPrometheus } from '@brawltome/telemetry'
import { serve } from 'bun'
import { Hono } from 'hono'
import { internalSecretValid } from './auth/internal-secret'
import { createWorkerDatabases } from './database-pools'
import { createDiscoveryReconciliationBackoff } from './discovery-reconciliation-backoff'
import { createFreshnessPlanner, readFreshnessPlannerConfig } from './freshness-planner'
import { createHealthRoutes } from './health-routes'
import {
  leaderboardDeepCrawlScheduleDefinitions,
  leaderboardScheduleDefinitions,
  rankingRetentionScheduleDefinition,
  readBrawlhallaV1RequestLimit,
  readOperationsWorkerConfig,
  readSourceBackgroundHeadroom,
} from './operations-worker-config'
import { runOperationsWorker } from './operations-worker-runtime'
import {
  createPlayerNameVerificationExecutor,
  createPlayerNameVerificationPlanner,
  readPlayerNameVerificationConfig,
} from './player-name-verification'
import { createPostgresReadiness } from './postgres-readiness'
import { reconcileInteractiveAdmissions, runOneRefreshOperation } from './refresh-operations-worker'
import { readAuthenticatedRefreshIpLimit, readPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { reconcileStatisticsCohort } from './statistics-cohort-reconciliation'
import { collectStatisticsEvidence } from './statistics-collection-source'
import { createRuntimeTelemetry } from './telemetry'
import { workerModules } from './worker-modules'

const configuredConnectionString = process.env.DATABASE_URL

if (!configuredConnectionString) throw new Error('DATABASE_URL is required')

const configuredApiKey = process.env.BRAWLHALLA_API_KEY

if (!configuredApiKey) throw new Error('BRAWLHALLA_API_KEY is required')

const apiKey: string = configuredApiKey

const legendReferences = createLegendReferenceIndex(
  legends
    .filter(({ displayName, weaponOne, weaponTwo }) => displayName && weaponOne && weaponTwo)
    .map((legend) => ({
      legendId: legend.heroId,
      legendNameKey: legendSlug(legend.heroId, legend.displayName),
      bioName: legend.displayName,
      weaponOne: legend.weaponOne,
      weaponTwo: legend.weaponTwo,
    })),
)

checkModuleList(workerModules)

const telemetry = createRuntimeTelemetry('operations-worker')
const workerConfig = readOperationsWorkerConfig(process.env)
// three clients by role (main, lease renewals, discovery), sized in database-pools.ts to fit the connection budget
const databases = createWorkerDatabases(configuredConnectionString, workerConfig)
const brawlhallaV1RequestLimit = readBrawlhallaV1RequestLimit(process.env.BRAWLHALLA_V1_REQUEST_LIMIT)

const sourceBackgroundHeadroom = readSourceBackgroundHeadroom(
  process.env.SOURCE_BACKGROUND_HEADROOM,
  Math.min(brawlhallaV0RequestLimit, brawlhallaV1RequestLimit),
)

const accounts = createPostgresAccounts(databases.main)
// projection and reconciliation work runs on the discovery client; the quick checks the scheduler and claims make
// use the main one, so they never queue behind a reconciliation that holds the discovery connections for minutes
const discovery = createPostgresDiscovery(databases.discovery)
const discoveryChecks = createPostgresDiscovery(databases.main)

const operations = createPostgresRefreshOperations(
  { database: databases.main, renewals: databases.renewals },
  { discoveryEffects: discoveryChecks },
)

const requestAdmission = createPostgresRequestAdmission(databases.main, {
  authenticatedIpLimit: readAuthenticatedRefreshIpLimit(process.env.AUTHENTICATED_REFRESH_IP_LIMIT),
  sourceLimits: {
    'brawlhalla-v0': brawlhallaV0RequestLimit,
    'brawlhalla-v1': brawlhallaV1RequestLimit,
  },
  sourceWindowSeconds: { 'brawlhalla-v1': 5 * 60 },
  sourceBackgroundHeadroom,
  minimumSourceSpacingMs: 150,
})

const bhapiQueue = createBhApiRequestQueue()

function createWorkerBhApiClient(beforeRequest?: BhApiClientOptions['beforeRequest']): BhApiClient {
  return new BhApiClient({
    apiKey,
    telemetry,
    queue: bhapiQueue,
    beforeRequest,
    onRateLimited: ({ domain, retryAfterMs }) =>
      requestAdmission.pauseSource(domain, Math.max(1, Math.ceil(retryAfterMs / 1_000))),
  })
}

const ranking = createPostgresRanking(databases.main)
const statistics = createPostgresStatistics(databases.main)
const careerPlayers = createPostgresCareerPlayers(databases.main)
const leaderboardPlayerNames = createPostgresLeaderboardPlayerNames(databases.main)
const leaderboardRanked = createPostgresLeaderboardRanked(databases.main)
const playerFreshness = createPostgresPlayerFreshness(databases.main)
const profileViews = createPostgresProfileViews(databases.main)
const playerNameVerifications = createPostgresPlayerNameVerifications(databases.main)

const rankedPlayers = createPostgresRankedPlayers(databases.main, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayers.mainLegendById(brawlhallaId),
})

const clans = createPostgresClans(databases.main)
const playerDiscoverySource = createPostgresPlayerDiscoverySource(databases.discovery)
const clanDiscoverySource = createPostgresClanDiscoverySource(databases.discovery)
const playerDiscoveryChecks = createPostgresPlayerDiscoverySource(databases.main)
const clanDiscoveryChecks = createPostgresClanDiscoverySource(databases.main)

const postgresReadiness = createPostgresReadiness(
  databases.main.sql,
  workerModules.flatMap((module) => module.migrations),
)

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
    // after the job loops have drained and the listener is gone: nothing uses the databases any more
    { name: 'database-main', close: databases.main.close },
    { name: 'database-renewals', close: databases.renewals.close },
    { name: 'database-discovery', close: databases.discovery.close },
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

healthServer.current = serve({ port: readPort('HEALTH_PORT', process.env.HEALTH_PORT, 3001), fetch: healthFetch })
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

const discoveryReconciliationBackoff = createDiscoveryReconciliationBackoff({
  baseMs: workerConfig.discovery.reconciliationFailureBackoffMs,
  maxMs: workerConfig.discovery.reconciliationMaxFailureBackoffMs,
  operationStatus: operations.operationStatus,
})

const leaderboardSchedules = leaderboardScheduleDefinitions(workerConfig.leaderboard)
const rankingRetentionSchedule = rankingRetentionScheduleDefinition(workerConfig.rankingRetention)
const deepCrawlSchedules = leaderboardDeepCrawlScheduleDefinitions(workerConfig.deepCrawl)
const nameVerificationConfig = readPlayerNameVerificationConfig(process.env)

// The same rolling-window usage request admission enforces and source_quota_used reports.
async function readV0SourceUsage() {
  const usage = await requestAdmission.inspectCurrentUsage()
  const v0 = usage.domains.find(({ domain }) => domain === 'brawlhalla-v0')

  if (!v0) throw new Error('brawlhalla-v0 source admission is not configured')

  return v0
}

const nameVerificationPlanner = createPlayerNameVerificationPlanner({
  config: nameVerificationConfig,
  readSourceUsage: readV0SourceUsage,
  readDemandIds: accounts.demand.readPlayerIds,
  verifications: playerNameVerifications,
  operations,
  telemetry,
})

const freshnessPlanner = createFreshnessPlanner({
  config: readFreshnessPlannerConfig(process.env),
  readSourceUsage: readV0SourceUsage,
  operations,
  profileViews,
  freshness: playerFreshness,
  telemetry,
})

const executePlayerNameVerification = createPlayerNameVerificationExecutor({
  config: nameVerificationConfig,
  readSourceUsage: readV0SourceUsage,
  verifications: playerNameVerifications,
  rankedPlayers,
  rankedSource: (admitSourceCall) => {
    const admittedBhapi = createWorkerBhApiClient(({ domain }) => admitSourceCall(domain))

    return { getRanked: (brawlhallaId, options) => admittedBhapi.getPlayerRanked(brawlhallaId, options) }
  },
  telemetry,
})

let leaderboardSchedulesReconciled = false

try {
  await runOperationsWorker({
    operations,
    lifecycle,
    workerId,
    config: workerConfig,
    telemetry,
    onStall: (stalledForMs) => {
      telemetry.logger.error('operations_worker.stalled', new Error('Operations worker loops stopped progressing'), {
        stalledForMs,
      })

      process.exitCode = 1
      requestShutdown()
    },
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
          source: playerDiscoveryChecks,
        },
        {
          owner: 'clan' as const,
          kind: 'clan-discovery-projection' as const,
          source: clanDiscoveryChecks,
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

        if (
          (await discoveryChecks.reconciliationDue(
            definition.owner,
            workerConfig.discovery.reconciliationIntervalMs,
          )) &&
          (await discoveryReconciliationBackoff.shouldEnqueue(definition.owner))
        ) {
          const reconciliation = await operations.accept({
            kind: 'discovery-reconciliation',
            dedupeKey: `discovery:${definition.owner}:reconciliation`,
            operationKey: `discovery:${definition.owner}:reconciliation:${randomUUID()}`,
            workClass: 'projection',
            payload: { owner: definition.owner },
            provenance: { source: 'owner-fact-reconciliation', requestedBy: 'issue-200' },
          })

          discoveryReconciliationBackoff.recordEnqueued(definition.owner, reconciliation.operationId)
          if (reconciliation.outcome === 'accepted') reconciledDiscovery++
        }
      }

      const reconciledStatistics =
        (await reconcileStatisticsCohort(statistics, operations, ranking.queries)) +
        (await nameVerificationPlanner.tick()) +
        (await freshnessPlanner.tick())

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

      const retention = workerConfig.rankingRetention.enabled
        ? await operations.reconcileRankingRetentionSchedule(rankingRetentionSchedule)
        : await operations.disableRankingRetentionSchedule(rankingRetentionSchedule.scheduleKey)

      if (retention.outcome !== 'already-exists' && retention.outcome !== 'already-disabled') reconciledSchedules++

      telemetry.logger.info('ranking.retention.scheduled', {
        enabled: workerConfig.rankingRetention.enabled,
        outcome: retention.outcome,
        retentionHours: workerConfig.rankingRetention.retentionHours,
        maxGenerations: workerConfig.rankingRetention.maxGenerations,
      })

      for (const definition of deepCrawlSchedules) {
        const crawl = workerConfig.deepCrawl.enabled
          ? await operations.reconcileLeaderboardDeepCrawlSchedule(definition)
          : await operations.disableLeaderboardDeepCrawlSchedule(definition.scheduleKey)

        if (crawl.outcome !== 'already-exists' && crawl.outcome !== 'already-disabled') reconciledSchedules++
      }

      telemetry.logger.info('leaderboard.deep_crawl.scheduled', {
        enabled: workerConfig.deepCrawl.enabled,
        intervalMs: workerConfig.deepCrawl.intervalMs,
      })

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
        sourceUnavailableRetryMs: workerConfig.sourceUnavailableRetryMs,
        sourceAdmission: requestAdmission,
        executeEffect: async (lease) => {
          if (!lease.operationKey.startsWith('primary-player:')) return operations.commitProofEffect(lease)

          const admittedBhapi = createWorkerBhApiClient(async ({ domain }) => {
            const admission = await requestAdmission.admitSource({
              domain,
              reservationKey: `${lease.operationId}:primary-player:${lease.attemptNumber}`,
              units: 1,
              caller: 'background',
            })

            if (admission.outcome === 'rate-limited') {
              throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
            }
          })

          await accounts.accounts.resolvePrimaryPlayerVerification(
            lease.payload.value,
            createSteamPlayerEvidenceResolver(admittedBhapi),
          )

          return operations.commitProofEffect(lease)
        },
        ranking,
        rankingRetention: ranking,
        rankingRetentionEnabled: workerConfig.rankingRetention.enabled,
        leaderboardPlayerNames,
        leaderboardRanked,
        deepCrawlPageDelayMs: workerConfig.deepCrawl.pageDelayMs,
        leaderboardTeamModes: leaderboardRanked,
        leaderboardDeepCrawlProgress: {
          read: operations.readLeaderboardDeepCrawlProgress,
          save: operations.saveLeaderboardDeepCrawlProgress,
        },
        leaderboardSource: {
          fetchPage: (input) =>
            fetchLeaderboardPage(input, {
              onRateLimited: (retryAfterSeconds) => requestAdmission.pauseSource('brawlhalla-v1', retryAfterSeconds),
            }),
        },
        statistics,
        executeStatisticsCollection: (lease) => collectStatisticsEvidence(createWorkerBhApiClient(), lease),
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
            ? discoveryChecks.playerProjectionEffectState(effectOperationId)
            : discoveryChecks.clanProjectionEffectState(effectOperationId),
        isPrimaryMonitoringTarget: async (lease) => {
          const snapshot = await accounts.primaryMonitoring.readSnapshot()

          return snapshot.targets.some(
            (target) =>
              target.assignmentId === lease.payload.assignmentId && target.brawlhallaId === lease.payload.brawlhallaId,
          )
        },
        executeSection: async (lease, section, admitSourceCall, caller) => {
          const admittedBhapi = createWorkerBhApiClient(async ({ domain }) => {
            if (lease.workClass === 'primary-monitoring' && 'assignmentId' in lease.payload) {
              const { assignmentId } = lease.payload
              const snapshot = await accounts.primaryMonitoring.readSnapshot()

              const current = snapshot.targets.some(
                (target) => target.assignmentId === assignmentId && target.brawlhallaId === lease.payload.brawlhallaId,
              )

              if (!current) throw new Error('Primary Player assignment is no longer current')
            }

            await admitSourceCall(domain)
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
                const byId = legendReferences.getById(legendId)
                const byKey = legendReferences.getByKey(legendNameKey)

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
        executePlayerNameVerification,
        executeRankedPulse: async (lease, admitSourceCall) => {
          const admittedBhapi = createWorkerBhApiClient(({ domain }) => admitSourceCall(domain))

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
          const admittedBhapi = createWorkerBhApiClient(({ domain }) => admitSourceCall(domain))

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
