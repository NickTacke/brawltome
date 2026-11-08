import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
  type StatisticsPublicationPayload,
} from '@brawltome/refresh-operations'
import { statisticsPublicationEffectState } from '../db/effects'
import type { PublicationAuthorization, StatisticsTracer } from '../index'
import { completeAttempt, deadLetterAttempt, deferAttempt } from './job-outcomes'

export type StatisticsPublicationJobDependencies = {
  statistics: Pick<StatisticsTracer, 'preflightPublication' | 'validateAndPublish'>
}

type PublicationLease = Lease<StatisticsPublicationPayload>

function publicationAuthorization(lease: PublicationLease): PublicationAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: 'statistics-publication',
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    generationId: lease.payload.generationId,
    product: lease.payload.product,
  }
}

function deadLetterConflict(tools: JobTools, lease: PublicationLease): Promise<AttemptOutcome> {
  return deadLetterAttempt(
    tools.queue,
    lease,
    'statistics_effect_conflict',
    'Statistics publication identity conflicts',
  )
}

async function runPublication(
  lease: PublicationLease,
  tools: JobTools,
  { statistics }: StatisticsPublicationJobDependencies,
): Promise<AttemptOutcome> {
  const { queue, leaseMs, retryDelayMs } = tools

  if ((await queue.renew(lease, leaseMs)) === 'lease-lost') return 'lease_lost'

  const authorization = publicationAuthorization(lease)
  const preflight = await statistics.preflightPublication(authorization)

  if (preflight === 'already-applied') return completeAttempt(queue, lease)

  if (preflight === 'effect-conflict') return deadLetterConflict(tools, lease)

  const published = await statistics.validateAndPublish(authorization)

  if (published.result === 'lease-lost') return 'lease_lost'

  if (published.result === 'collection-active') {
    const failure = {
      code: 'statistics_collection_active',
      message: 'Statistics collection replay is still active',
      retryable: true,
    }

    return deferAttempt(queue, lease, failure, retryDelayMs)
  }

  if (published.result === 'effect-conflict') return deadLetterConflict(tools, lease)

  return completeAttempt(queue, lease)
}

export function createStatisticsPublicationJob(
  dependencies: StatisticsPublicationJobDependencies,
): JobDefinition<StatisticsPublicationPayload> {
  return defineJob<StatisticsPublicationPayload>({
    kind: 'statistics-publication',
    workClasses: ['global-statistics'],
    failureCode: 'statistics_publication_failed',
    // claim already shapes this payload
    parsePayload: (value) => value as StatisticsPublicationPayload,
    effectState: statisticsPublicationEffectState,
    run: (lease, tools) => runPublication(lease, tools, dependencies),
  })
}
