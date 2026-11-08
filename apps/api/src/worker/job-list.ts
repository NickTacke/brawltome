import {
  createPrimaryPlayerVerificationJob,
  type PrimaryPlayerVerificationJobDependencies,
  proofEffectState,
} from '@brawltome/accounts'
import type { BhApiClient, BhApiClientOptions } from '@brawltome/bhapi'
import { type ClanRefreshJobDependencies, type ClanSource, createClanRefreshJob } from '@brawltome/clan'
import {
  type ClanProjectionSource,
  createClanDiscoveryProjectionJob,
  createDiscoveryReconciliationJob,
  createPlayerDiscoveryProjectionJob,
  type PlayerProjectionSource,
  type PostgresDiscovery,
} from '@brawltome/discovery'
import {
  type CareerLegendResolver,
  createInteractivePlayerRefreshJob,
  createPlayerNameVerificationJob,
  createRankedPlayerPulseJob,
  type PlayerNameVerificationJobDependencies,
  type PostgresCareerPlayers,
  type PostgresRankedPlayers,
  type PrimaryMonitoringSnapshot,
} from '@brawltome/player'
import {
  createLeaderboardCollectionJob,
  createLeaderboardDeepCrawlJob,
  createRankingRetentionJob,
  type LeaderboardCollectionJobDependencies,
  type LeaderboardDeepCrawlJobDependencies,
  type RankingRetentionStore,
} from '@brawltome/ranking'
import {
  completeWithProofEffect,
  defineJob,
  type JobDefinition,
  type Lease,
  leaderboardOperationKinds,
  type ProofEffectPayload,
  workClasses,
} from '@brawltome/refresh-operations'
import {
  createStatisticsLegendMetaPublicationJob,
  createStatisticsLifetimeCollectionJob,
  createStatisticsPublicationJob,
  createStatisticsRankedCollectionJob,
  type StatisticsCollectionJobDependencies,
  type StatisticsLegendMetaPublicationJobDependencies,
  type StatisticsPublicationJobDependencies,
} from '@brawltome/statistics'
import type { Telemetry } from '@brawltome/telemetry'

export type WorkerDiscoveryDependencies = {
  // projection and reconciliation work, on the discovery client
  work: Pick<PostgresDiscovery, 'deliverPendingPlayers' | 'deliverPendingClans' | 'reconcilePlayers' | 'reconcileClans'>
  // the quick checks claim makes, on the main client so they never queue behind a reconciliation
  checks: Pick<PostgresDiscovery, 'projectionEffectState' | 'reconciliationEffectApplied'>
  playerSource: PlayerProjectionSource
  clanSource: ClanProjectionSource
  leaseActive(lease: Lease<unknown>): Promise<boolean>
}

export type WorkerClanDependencies = {
  clans: ClanRefreshJobDependencies['clans']
  // the worker's Brawlhalla client, built around one section's source admission
  createBrawlhallaClient(beforeRequest: BhApiClientOptions['beforeRequest']): ClanSource
}

export type WorkerAccountsDependencies = PrimaryPlayerVerificationJobDependencies & {
  primaryMonitoring: { readSnapshot(): Promise<PrimaryMonitoringSnapshot> }
}

type PlayerBrawlhallaClient = Pick<
  BhApiClient,
  'getPlayerRanked' | 'getPlayerStats' | 'getPlayerStatsV1Payload' | 'getPlayerTeamsV1Payload'
>

export type WorkerPlayerDependencies = {
  rankedPlayers: PostgresRankedPlayers
  careerPlayers: PostgresCareerPlayers
  // the worker's Brawlhalla client, built around one section's source admission
  createBrawlhallaClient(beforeRequest: BhApiClientOptions['beforeRequest']): PlayerBrawlhallaClient
  resolveLegendReference: CareerLegendResolver
  verifyName: PlayerNameVerificationJobDependencies['verifyName']
}

export type WorkerStatisticsDependencies = Omit<StatisticsCollectionJobDependencies, 'statistics'> & {
  statistics: StatisticsCollectionJobDependencies['statistics'] &
    StatisticsPublicationJobDependencies['statistics'] &
    StatisticsLegendMetaPublicationJobDependencies['statistics']
}

export type WorkerLeaderboardDependencies = LeaderboardCollectionJobDependencies & LeaderboardDeepCrawlJobDependencies

export type WorkerJobDependencies = {
  ranking: RankingRetentionStore
  leaderboards: WorkerLeaderboardDependencies
  isRankingRetentionEnabled: boolean
  telemetry: Telemetry
  discovery: WorkerDiscoveryDependencies
  clan: WorkerClanDependencies
  accounts: WorkerAccountsDependencies
  player: WorkerPlayerDependencies
  statistics: WorkerStatisticsDependencies
}

function createDiscoveryJobs(discovery: WorkerDiscoveryDependencies): JobDefinition<unknown>[] {
  const { work, checks, playerSource, clanSource, leaseActive } = discovery

  const playerProjection = createPlayerDiscoveryProjectionJob({
    deliverPending: (batchSize, effectOperationId, isLeaseActive) =>
      work.deliverPendingPlayers(playerSource, batchSize, effectOperationId, isLeaseActive),
    projectionEffectState: (effectOperationId) => checks.projectionEffectState('player', effectOperationId),
    leaseActive,
  })

  const clanProjection = createClanDiscoveryProjectionJob({
    deliverPending: (batchSize, effectOperationId, isLeaseActive) =>
      work.deliverPendingClans(clanSource, batchSize, effectOperationId, isLeaseActive),
    projectionEffectState: (effectOperationId) => checks.projectionEffectState('clan', effectOperationId),
    leaseActive,
  })

  const reconciliation = createDiscoveryReconciliationJob({
    reconcile: (owner, effectOperationId, isLeaseActive) =>
      owner === 'player'
        ? work.reconcilePlayers(playerSource, effectOperationId, isLeaseActive)
        : work.reconcileClans(clanSource, effectOperationId, isLeaseActive),
    reconciliationEffectApplied: (effectOperationId) => checks.reconciliationEffectApplied(effectOperationId),
    leaseActive,
  })

  return [playerProjection, clanProjection, reconciliation]
}

function createClanJobs({ clans, createBrawlhallaClient }: WorkerClanDependencies): JobDefinition<unknown>[] {
  const clanRefresh = createClanRefreshJob({
    clans,
    createAdmittedSource: (admitSource) => createBrawlhallaClient(({ domain }) => admitSource(domain)),
  })

  return [clanRefresh]
}

function createPlayerJobs(
  player: WorkerPlayerDependencies,
  primaryMonitoring: WorkerAccountsDependencies['primaryMonitoring'],
): JobDefinition<unknown>[] {
  const { rankedPlayers, careerPlayers, createBrawlhallaClient, resolveLegendReference, verifyName } = player

  const interactiveRefresh = createInteractivePlayerRefreshJob({
    rankedPlayers,
    careerPlayers,
    resolveLegendReference,
    isPrimaryMonitoringTarget: async (assignmentId, brawlhallaId) => {
      const snapshot = await primaryMonitoring.readSnapshot()

      return snapshot.targets.some(
        (target) => target.assignmentId === assignmentId && target.brawlhallaId === brawlhallaId,
      )
    },
    createAdmittedSource: (admitSource) => {
      const client = createBrawlhallaClient(({ domain }) => admitSource(domain))

      return {
        getRanked: (brawlhallaId, options) => client.getPlayerRanked(brawlhallaId, options),
        getStats: (brawlhallaId, options) => client.getPlayerStats(brawlhallaId, options),
      }
    },
  })

  const rankedPulse = createRankedPlayerPulseJob({
    rankedPlayers,
    createAdmittedPulseSource: (admitSource) => {
      const client = createBrawlhallaClient(({ domain }) => admitSource(domain))

      return {
        getOneVsOne: (brawlhallaId, options) => client.getPlayerStatsV1Payload(brawlhallaId, 'ranked_1v1', options),
        getFixedTeams: (brawlhallaId, options) => client.getPlayerTeamsV1Payload(brawlhallaId, options),
      }
    },
  })

  const nameVerification = createPlayerNameVerificationJob({ verifyName })

  return [interactiveRefresh, rankedPulse, nameVerification]
}

function createLeaderboardJobs(leaderboards: WorkerLeaderboardDependencies): JobDefinition<unknown>[] {
  const collections = leaderboardOperationKinds.map((kind) => createLeaderboardCollectionJob(kind, leaderboards))

  return [...collections, createLeaderboardDeepCrawlJob(leaderboards)]
}

export function createStatisticsJobs(statistics: WorkerStatisticsDependencies): JobDefinition<unknown>[] {
  return [
    createStatisticsRankedCollectionJob(statistics),
    createStatisticsLifetimeCollectionJob(statistics),
    createStatisticsPublicationJob(statistics),
    createStatisticsLegendMetaPublicationJob(statistics),
  ]
}

// a proof row with a primary-player key is a verification written before the kind existed, or a replay of one
function createProofJob(
  primaryPlayerVerification: JobDefinition<ProofEffectPayload>,
): JobDefinition<ProofEffectPayload> {
  return defineJob<ProofEffectPayload>({
    kind: 'proof',
    workClasses,
    failureCode: 'proof_execution_failed',
    // claim already shapes this payload
    parsePayload: (value) => value as ProofEffectPayload,
    effectState: proofEffectState,
    run(lease, tools) {
      if (lease.operationKey.startsWith('primary-player:')) return primaryPlayerVerification.run(lease, tools)

      return completeWithProofEffect(lease, tools)
    },
  })
}

export function createWorkerJobs(dependencies: WorkerJobDependencies): JobDefinition<unknown>[] {
  const rankingRetention = createRankingRetentionJob({
    store: dependencies.ranking,
    isEnabled: dependencies.isRankingRetentionEnabled,
    telemetry: dependencies.telemetry,
  })

  const primaryPlayerVerification = createPrimaryPlayerVerificationJob(dependencies.accounts)

  return [
    rankingRetention,
    ...createLeaderboardJobs(dependencies.leaderboards),
    ...createDiscoveryJobs(dependencies.discovery),
    ...createClanJobs(dependencies.clan),
    ...createPlayerJobs(dependencies.player, dependencies.accounts.primaryMonitoring),
    ...createStatisticsJobs(dependencies.statistics),
    primaryPlayerVerification,
    createProofJob(primaryPlayerVerification),
  ]
}
