import type { Accounts } from '@brawltome/accounts'
import type { BhApiClientOptions } from '@brawltome/bhapi'
import { type ClanRefreshJobDependencies, type ClanSource, createClanRefreshJob } from '@brawltome/clan'
import {
  type ClanProjectionSource,
  createClanDiscoveryProjectionJob,
  createDiscoveryReconciliationJob,
  createPlayerDiscoveryProjectionJob,
  type PlayerProjectionSource,
  type PostgresDiscovery,
} from '@brawltome/discovery'
import { createRankingRetentionJob, type RankingRetentionStore } from '@brawltome/ranking'
import {
  completeWithProofEffect,
  defineJob,
  type JobDefinition,
  type Lease,
  type ProofEffectPayload,
  proofEffectState,
  workClasses,
} from '@brawltome/refresh-operations'
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

type PrimaryPlayerEvidenceResolver = Parameters<Accounts['resolvePrimaryPlayerVerification']>[1]

export type WorkerAccountsDependencies = {
  accounts: Pick<Accounts, 'resolvePrimaryPlayerVerification'>
  // the worker's Steam resolver, with every Brawlhalla call admitted under this lease
  createEvidenceResolver(lease: Lease<ProofEffectPayload>): PrimaryPlayerEvidenceResolver
}

export type WorkerJobDependencies = {
  ranking: RankingRetentionStore
  isRankingRetentionEnabled: boolean
  telemetry: Telemetry
  discovery: WorkerDiscoveryDependencies
  clan: WorkerClanDependencies
  accounts: WorkerAccountsDependencies
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

function createProofJob({
  accounts,
  createEvidenceResolver,
}: WorkerAccountsDependencies): JobDefinition<ProofEffectPayload> {
  return defineJob<ProofEffectPayload>({
    kind: 'proof',
    workClasses,
    failureCode: 'proof_execution_failed',
    // claim already shapes this payload
    parsePayload: (value) => value as ProofEffectPayload,
    effectState: proofEffectState,
    async run(lease, tools) {
      if (lease.operationKey.startsWith('primary-player:')) {
        await accounts.resolvePrimaryPlayerVerification(lease.payload.value, createEvidenceResolver(lease))
      }

      return completeWithProofEffect(lease, tools)
    },
  })
}

// the jobs that live in their owning module; the rest are still wrapped in refresh-operations-worker.ts
export function createWorkerJobs(dependencies: WorkerJobDependencies): JobDefinition<unknown>[] {
  const rankingRetention = createRankingRetentionJob({
    store: dependencies.ranking,
    isEnabled: dependencies.isRankingRetentionEnabled,
    telemetry: dependencies.telemetry,
  })

  return [
    rankingRetention,
    ...createDiscoveryJobs(dependencies.discovery),
    ...createClanJobs(dependencies.clan),
    createProofJob(dependencies.accounts),
  ]
}
