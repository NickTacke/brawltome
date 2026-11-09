import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type LeaderboardOperationKind,
  type LeaderboardOperationPayload,
  type Lease,
  type RetryTimings,
} from '@brawltome/queue'
import { leaderboardEffectState } from '../db/leaderboard-effects'
import {
  collectAndPublishLeaderboardGeneration,
  leaderboardModeFromOperationKind,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
} from '../leaderboard'
import { type AdmittedPageFetchDependencies, createAdmittedPageFetch } from './admitted-page-fetch'
import { decideLeaderboardFailure } from './leaderboard-failure'
import { leaderboardCollectionContract } from './leaderboard-job-contracts'
import { type PlayerPropagationDependencies, withPlayerPropagation } from './player-propagation'

type LeaderboardCollectionLease = Lease<LeaderboardOperationPayload> & { kind: LeaderboardOperationKind }

export type LeaderboardCollectionJobDependencies = AdmittedPageFetchDependencies &
  PlayerPropagationDependencies & {
    publication: RankingPublicationStore
    retryTimings: RetryTimings
  }

function publicationAuthorization(lease: LeaderboardCollectionLease): RankingPublicationAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    operationKind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    scheduleWindowAt: lease.scheduleWindowAt,
  }
}

async function runCollection(
  lease: LeaderboardCollectionLease,
  tools: JobTools,
  dependencies: LeaderboardCollectionJobDependencies,
): Promise<AttemptOutcome> {
  await collectAndPublishLeaderboardGeneration({
    mode: leaderboardModeFromOperationKind(lease.kind),
    authorization: publicationAuthorization(lease),
    source: { fetchPage: createAdmittedPageFetch(lease, tools, dependencies) },
    publication: withPlayerPropagation(dependencies.publication, dependencies),
    pageDepth: lease.payload.pageDepth,
    intervalMs: lease.payload.intervalMs,
  })

  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export function createLeaderboardCollectionJob(
  kind: LeaderboardOperationKind,
  dependencies: LeaderboardCollectionJobDependencies,
): JobDefinition<LeaderboardOperationPayload> {
  return defineJob<LeaderboardOperationPayload>({
    ...leaderboardCollectionContract(kind),
    failureCode: 'leaderboard_collection_failed',
    effectState: leaderboardEffectState,
    decideFailure: async (error) => decideLeaderboardFailure(error, dependencies.retryTimings),
    run: (lease, tools) => runCollection({ ...lease, kind }, tools, dependencies),
  })
}
