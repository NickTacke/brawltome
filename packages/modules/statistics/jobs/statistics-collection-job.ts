import {
  type AttemptOutcome,
  decideCountedSourceOutage,
  defineJob,
  type FailureDecision,
  type JobDefinition,
  type JobTools,
  type Lease,
  type LeaseOperations,
  type RetryTimings,
  SourceAdmissionLimitedError,
  type SourceAdmissionPort,
  type StatisticsCollectionKind,
  type StatisticsCollectionPayload,
} from '@brawltome/queue'
import { statisticsCollectionEffectState } from '../db/effects'
import type { CollectionAttemptAuthorization, LifetimeEvidence, RankedEvidence, StatisticsTracer } from '../index'
import { completeAttempt, deadLetterAttempt } from './job-outcomes'
import { statisticsCollectionContract } from './statistics-job-contracts'

export type StatisticsCollectionLease = Lease<StatisticsCollectionPayload> & { kind: StatisticsCollectionKind }

export type StatisticsCollectionJobDependencies = {
  statistics: Pick<
    StatisticsTracer,
    'preflightCollection' | 'preflightCollectionAttempt' | 'recordCollectionAttempt' | 'commitObservation'
  >
  sourceAdmission: Pick<SourceAdmissionPort, 'admitSource'>
  collectEvidence(lease: StatisticsCollectionLease): Promise<RankedEvidence | LifetimeEvidence>
  collectionPace: { waitMsForTurn(operationId: string): number }
  retryTimings: RetryTimings
}

// the third failure ends the operation, so these keep a short outage from using up one player's three calls
const sourceOutageRetryDelaysMs = [5 * 60_000, 30 * 60_000]

type AttemptCheck = Awaited<
  ReturnType<
    StatisticsCollectionJobDependencies['statistics']['preflightCollectionAttempt' | 'recordCollectionAttempt']
  >
>

function deadLetterEffectConflict(queue: LeaseOperations, lease: StatisticsCollectionLease): Promise<AttemptOutcome> {
  return deadLetterAttempt(queue, lease, 'statistics_effect_conflict', 'Statistics effect identity conflicts')
}

// the check before admission and the record after it refuse an attempt the same way; null means it may go on
async function settleRefusedAttempt(
  queue: LeaseOperations,
  lease: StatisticsCollectionLease,
  check: AttemptCheck,
): Promise<AttemptOutcome | null> {
  if (check === 'lease-lost') return 'lease_lost'

  if (check === 'capacity-exceeded') {
    return deadLetterAttempt(
      queue,
      lease,
      'statistics_capacity_exceeded',
      'Statistics source attempt capacity is exhausted',
    )
  }

  if (check === 'effect-conflict') {
    return deadLetterAttempt(queue, lease, 'statistics_effect_conflict', 'Statistics attempt identity conflicts')
  }

  return null
}

// one source call per attempt, under a key that stays the same if this attempt admits again
async function admitSourceCall(
  lease: StatisticsCollectionLease,
  sourceAdmission: StatisticsCollectionJobDependencies['sourceAdmission'],
): Promise<void> {
  const admission = await sourceAdmission.admitSource({
    domain: 'brawlhalla-v1',
    reservationKey: `${lease.operationId}:${lease.attemptNumber}:${lease.kind}`,
    units: 1,
    caller: 'background',
  })

  if (admission.outcome === 'rate-limited') throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
}

function commitEvidence(
  statistics: StatisticsCollectionJobDependencies['statistics'],
  lease: StatisticsCollectionLease,
  authorization: CollectionAttemptAuthorization,
  evidence: RankedEvidence | LifetimeEvidence,
) {
  if (lease.kind === 'statistics-ranked-collection') {
    return statistics.commitObservation({
      authorization: { ...authorization, kind: lease.kind },
      evidence: evidence as RankedEvidence,
    })
  }

  return statistics.commitObservation({
    authorization: { ...authorization, kind: lease.kind },
    evidence: evidence as LifetimeEvidence,
  })
}

// a 5xx comes after the attempt is recorded, and handing the attempt back would make the retry look like a different
// lease reusing that record. it spends the attempt instead, so a player gets three source calls and no more
function decideCollectionFailure(
  error: unknown,
  lease: StatisticsCollectionLease,
  retryTimings: RetryTimings,
): FailureDecision | null {
  const delayMs = sourceOutageRetryDelaysMs[lease.attemptNumber - 1] ?? 0

  return decideCountedSourceOutage(error, delayMs, retryTimings)
}

function collectionAuthorization(lease: StatisticsCollectionLease): CollectionAttemptAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    attemptNumber: lease.attemptNumber,
    cohortId: lease.payload.cohortId,
    brawlhallaId: lease.payload.brawlhallaId,
  }
}

async function runCollection(
  lease: StatisticsCollectionLease,
  { queue, leaseMs }: JobTools,
  dependencies: StatisticsCollectionJobDependencies,
): Promise<AttemptOutcome> {
  const { statistics, sourceAdmission, collectEvidence, collectionPace } = dependencies

  if ((await queue.renew(lease, leaseMs)) === 'lease-lost') return 'lease_lost'

  const authorization = collectionAuthorization(lease)
  const preflight = await statistics.preflightCollection(authorization)

  if (preflight === 'already-applied') return completeAttempt(queue, lease)

  if (preflight === 'effect-conflict') return deadLetterEffectConflict(queue, lease)

  const attemptRefused = await settleRefusedAttempt(
    queue,
    lease,
    await statistics.preflightCollectionAttempt(authorization),
  )

  if (attemptRefused) return attemptRefused

  const waitMs = collectionPace.waitMsForTurn(lease.operationId)

  if (waitMs > 0) throw new SourceAdmissionLimitedError(Math.ceil(waitMs / 1_000))

  await admitSourceCall(lease, sourceAdmission)

  if ((await queue.renew(lease, leaseMs)) === 'lease-lost') return 'lease_lost'

  const recordRefused = await settleRefusedAttempt(
    queue,
    lease,
    await statistics.recordCollectionAttempt(authorization),
  )

  if (recordRefused) return recordRefused

  const evidence = await collectEvidence(lease)
  const committed = await commitEvidence(statistics, lease, authorization, evidence)

  if (committed === 'lease-lost') return 'lease_lost'

  if (committed === 'effect-conflict') return deadLetterEffectConflict(queue, lease)

  return completeAttempt(queue, lease)
}

function createCollectionJob(
  kind: StatisticsCollectionKind,
  dependencies: StatisticsCollectionJobDependencies,
): JobDefinition<StatisticsCollectionPayload> {
  return defineJob<StatisticsCollectionPayload>({
    ...statisticsCollectionContract(kind),
    failureCode: 'statistics_collection_failed',
    effectState: statisticsCollectionEffectState,
    decideFailure: async (error, lease) =>
      decideCollectionFailure(error, { ...lease, kind }, dependencies.retryTimings),
    run: (lease, tools) => runCollection({ ...lease, kind }, tools, dependencies),
  })
}

export function createStatisticsRankedCollectionJob(
  dependencies: StatisticsCollectionJobDependencies,
): JobDefinition<StatisticsCollectionPayload> {
  return createCollectionJob('statistics-ranked-collection', dependencies)
}

export function createStatisticsLifetimeCollectionJob(
  dependencies: StatisticsCollectionJobDependencies,
): JobDefinition<StatisticsCollectionPayload> {
  return createCollectionJob('statistics-lifetime-collection', dependencies)
}
