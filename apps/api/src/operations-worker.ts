import { hostname } from 'node:os'
import { createPostgresAccounts, proofEffectStore } from '@brawltome/accounts'
import {
  BhApiClient,
  type BhApiClientOptions,
  brawlhallaV0RequestLimit,
  createBhApiRequestQueue,
  type RequestQueue,
} from '@brawltome/bhapi'
import {
  createPostgresClanDiscoverySource,
  createPostgresClans,
  createPostgresWeeklySnapshots,
  defaultClanWeeklySnapshotSliceGuilds,
  reconcileClanWeeklySnapshotSchedule,
} from '@brawltome/clan'
import { createPostgresDiscovery } from '@brawltome/discovery'
import { checkModuleList } from '@brawltome/foundation'
import { createLegendReferenceIndex, legendSlug, legends, normalizeWeaponName } from '@brawltome/game-data'
import {
  type CareerLegendReference,
  createPostgresCareerPlayers,
  createPostgresLeaderboardPlayerNames,
  createPostgresLeaderboardRanked,
  createPostgresPlayerDiscoverySource,
  createPostgresPlayerFreshness,
  createPostgresPlayerNameVerifications,
  createPostgresProfileViews,
  createPostgresRankedPlayers,
  createRecentlyViewedRefreshes,
  createSteamPlayerEvidenceResolver,
  reconcilePrimaryMonitoring,
} from '@brawltome/player'
import {
  createJobRegistry,
  createPostgresRefreshOperations,
  type Lease,
  runOneJob,
  SourceAdmissionLimitedError,
  waitForRenewal,
} from '@brawltome/queue'
import {
  createLeaderboardDeepCrawlProgress,
  createPostgresRanking,
  defaultDeepCrawlSlicePages,
  disableLeaderboardDeepCrawlSchedule,
  disableRankingRetentionSchedule,
  fetchLeaderboardPage,
  readAppliedLeaderboardEffects,
  reconcileLeaderboardDeepCrawlSchedule,
  reconcileLeaderboardSchedule,
  reconcileRankingRetentionSchedule,
} from '@brawltome/ranking'
import { createPostgresRequestAdmission } from '@brawltome/request-admission'
import { createPostgresStatistics, createStatisticsReservations } from '@brawltome/statistics'
import { instrumentHttpHandler, renderPrometheus } from '@brawltome/telemetry'
import { serve } from 'bun'
import { Hono } from 'hono'
import { internalSecretValid } from './auth/internal-secret'
import { createWorkerDatabases } from './database-pools'
import { createDiscoveryReconciliationBackoff } from './discovery-reconciliation-backoff'
import { createFreshnessPlanner, readFreshnessPlannerConfig } from './freshness-planner'
import { createHealthRoutes } from './health-routes'
import {
  clanWeeklySnapshotGuildDelayMs,
  clanWeeklySnapshotScheduleDefinition,
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
import { readAuthenticatedRefreshIpLimit, readPort, readRuntimeConfig } from './runtime-config'
import { createRuntimeLifecycle } from './runtime-lifecycle'
import { reconcileStatisticsCohort } from './statistics-cohort-reconciliation'
import { createStatisticsCollection } from './statistics-collection-source'
import { createRuntimeTelemetry } from './telemetry'
import { createWorkerJobs } from './worker/job-list'
import { createPlanners, runPlanners } from './worker/planners'
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

function resolveLegendReference(legendId: number, legendNameKey: string): CareerLegendReference | null {
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
}

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

const statistics = createPostgresStatistics(databases.main)
const statisticsReservations = createStatisticsReservations(databases.main)

const ranking = createPostgresRanking(databases.main)
const clans = createPostgresClans(databases.main)

const playerDiscoverySource = createPostgresPlayerDiscoverySource(databases.discovery)
const clanDiscoverySource = createPostgresClanDiscoverySource(databases.discovery)

const careerPlayers = createPostgresCareerPlayers(databases.main)
const playerNameVerifications = createPostgresPlayerNameVerifications(databases.main)

const rankedPlayers = createPostgresRankedPlayers(databases.main, {
  resolveCareerMainLegend: (brawlhallaId) => careerPlayers.mainLegendById(brawlhallaId),
})

const nameVerificationConfig = readPlayerNameVerificationConfig(process.env)

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

// the queue needs these jobs' effect checks to be built, so the jobs can only reach the queue once they run
const discoveryLeaseActive = (lease: Lease<unknown>): Promise<boolean> => operations.discoveryLeaseActive(lease)

const leaderboardPlayerNames = createPostgresLeaderboardPlayerNames(databases.main)
const leaderboardRanked = createPostgresLeaderboardRanked(databases.main)

const workerJobs = createWorkerJobs({
  ranking,
  leaderboards: {
    publication: ranking,
    source: {
      fetchPage: (input) =>
        fetchLeaderboardPage(input, {
          onRateLimited: (retryAfterSeconds) => requestAdmission.pauseSource('brawlhalla-v1', retryAfterSeconds),
        }),
    },
    sourceAdmission: { admitSource: (input) => requestAdmission.admitSource(input) },
    waitForSourceAdmission: waitForRenewal,
    waitForSourceRetry: waitForRenewal,
    playerNames: leaderboardPlayerNames,
    rankedStandings: leaderboardRanked,
    teamModes: leaderboardRanked,
    progress: createLeaderboardDeepCrawlProgress(databases.main),
    slicePages: defaultDeepCrawlSlicePages,
    pageDelayMs: workerConfig.deepCrawl.pageDelayMs,
    retryTimings: {
      retryDelayMs: workerConfig.retryDelayMs,
      sourceUnavailableRetryMs: workerConfig.sourceUnavailableRetryMs,
    },
    telemetry,
  },
  isRankingRetentionEnabled: workerConfig.rankingRetention.enabled,
  telemetry,
  discovery: {
    work: discovery,
    checks: discoveryChecks,
    playerSource: playerDiscoverySource,
    clanSource: clanDiscoverySource,
    leaseActive: discoveryLeaseActive,
  },
  clan: {
    clans,
    createBrawlhallaClient: createWorkerBhApiClient,
    weeklySnapshot: {
      snapshots: createPostgresWeeklySnapshots(databases.main),
      sliceGuilds: defaultClanWeeklySnapshotSliceGuilds,
      guildDelayMs: clanWeeklySnapshotGuildDelayMs,
      waitBetweenGuilds: waitForRenewal,
      waitBeforeGuildRetry: waitForRenewal,
      retryTimings: {
        retryDelayMs: workerConfig.retryDelayMs,
        sourceUnavailableRetryMs: workerConfig.sourceUnavailableRetryMs,
      },
      telemetry,
    },
  },
  accounts: {
    accounts: accounts.accounts,
    createEvidenceResolver: createPrimaryPlayerEvidenceResolver,
    primaryMonitoring: accounts.primaryMonitoring,
  },
  player: {
    rankedPlayers,
    careerPlayers,
    createBrawlhallaClient: createWorkerBhApiClient,
    resolveLegendReference,
    verifyName: executePlayerNameVerification,
  },
  statistics: {
    statistics,
    sourceAdmission: { admitSource: (input) => requestAdmission.admitSource(input) },
    ...createStatisticsCollection((queue) => createWorkerBhApiClient(undefined, queue)),
  },
})

const jobRegistry = createJobRegistry(workerJobs)

const operations = createPostgresRefreshOperations(
  { database: databases.main, renewals: databases.renewals },
  {
    jobs: workerJobs,
    onInvalidRow: ({ operationId, kind, reason }) =>
      telemetry.logger.error('operation.claim.invalid_row', new Error(reason), { operationId, kind }),
    proofEffects: proofEffectStore,
    readAppliedLeaderboardEffects,
  },
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

// not tools.createSourceAdmitter: verification spends background budget under a key of its own, whatever its work class
function createPrimaryPlayerEvidenceResolver(lease: Lease<unknown>) {
  const admittedBhapi = createWorkerBhApiClient(async ({ domain }) => {
    const admission = await requestAdmission.admitSource({
      domain,
      reservationKey: `${lease.operationId}:primary-player:${lease.attemptNumber}`,
      units: 1,
      caller: 'background',
    })

    if (admission.outcome === 'rate-limited') throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
  })

  return createSteamPlayerEvidenceResolver(admittedBhapi)
}

function createWorkerBhApiClient(
  beforeRequest?: BhApiClientOptions['beforeRequest'],
  queue: RequestQueue = bhapiQueue,
): BhApiClient {
  return new BhApiClient({
    apiKey,
    telemetry,
    queue,
    beforeRequest,
    onRateLimited: ({ domain, retryAfterMs }) =>
      requestAdmission.pauseSource(domain, Math.max(1, Math.ceil(retryAfterMs / 1_000))),
  })
}

const playerFreshness = createPostgresPlayerFreshness(databases.main)
const profileViews = createPostgresProfileViews(databases.main)

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
  operations: createRecentlyViewedRefreshes(databases.main),
  profileViews,
  freshness: playerFreshness,
  telemetry,
})

const planners = createPlanners({
  operations,
  actorAdmission: requestAdmission,
  primaryMonitoring: {
    readSnapshot: () => accounts.primaryMonitoring.readSnapshot(),
    reconcile: (snapshot) => reconcilePrimaryMonitoring(databases.main, snapshot),
  },
  discovery: {
    sources: { player: playerDiscoveryChecks, clan: clanDiscoveryChecks },
    checks: discoveryChecks,
    reconciliationBackoff: discoveryReconciliationBackoff,
    config: {
      projectionBatchSize: workerConfig.discovery.projectionBatchSize,
      reconciliationIntervalMs: workerConfig.discovery.reconciliationIntervalMs,
    },
  },
  statisticsCohort: { reconcile: () => reconcileStatisticsCohort(statistics, statisticsReservations, ranking.queries) },
  nameVerification: nameVerificationPlanner,
  freshness: freshnessPlanner,
  schedules: {
    store: {
      leaderboard: (schedule) => reconcileLeaderboardSchedule(databases.main, schedule),
      retention: (schedule) => reconcileRankingRetentionSchedule(databases.main, schedule),
      disableRetention: (scheduleKey) => disableRankingRetentionSchedule(databases.main, scheduleKey),
      deepCrawl: (schedule) => reconcileLeaderboardDeepCrawlSchedule(databases.main, schedule),
      disableDeepCrawl: (scheduleKey) => disableLeaderboardDeepCrawlSchedule(databases.main, scheduleKey),
      clanWeeklySnapshot: (schedule) => reconcileClanWeeklySnapshotSchedule(databases.main, schedule),
    },
    leaderboard: leaderboardSchedules,
    rankingRetention: { config: workerConfig.rankingRetention, definition: rankingRetentionSchedule },
    deepCrawl: { config: workerConfig.deepCrawl, definitions: deepCrawlSchedules },
    clanWeeklySnapshot: clanWeeklySnapshotScheduleDefinition(),
  },
  telemetry,
})

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
    reconcile: () => runPlanners(planners),
    ensureListener: async (onWakeup) => {
      listener ??= await operations.listen(onWakeup)
    },
    runOne: (repository, slotWorkerId, common) =>
      runOneJob(repository, slotWorkerId, jobRegistry, {
        ...common,
        sourceUnavailableRetryMs: workerConfig.sourceUnavailableRetryMs,
        sourceAdmission: requestAdmission,
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
