import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
  type StatisticsLegendMetaPublicationPayload,
} from '@brawltome/queue'
import { legendMetaPublicationEffectState } from '../db/effects'
import type { LegendMetaPublicationAuthorization, StatisticsTracer } from '../index'
import { completeAttempt, deadLetterAttempt, deferAttempt } from './job-outcomes'
import { statisticsLegendMetaPublicationContract } from './statistics-job-contracts'

export type StatisticsLegendMetaPublicationJobDependencies = {
  statistics: Pick<StatisticsTracer, 'preflightLegendMetaPublication' | 'buildAndPublishLegendMeta'>
}

type LegendMetaPublicationLease = Lease<StatisticsLegendMetaPublicationPayload>

function legendMetaAuthorization(lease: LegendMetaPublicationLease): LegendMetaPublicationAuthorization {
  return {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: 'statistics-legend-meta-publication',
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    generationId: lease.payload.generationId,
  }
}

function deadLetterConflict(tools: JobTools, lease: LegendMetaPublicationLease): Promise<AttemptOutcome> {
  return deadLetterAttempt(
    tools.queue,
    lease,
    'statistics_legend_meta_effect_conflict',
    'Statistics Legend Meta publication identity conflicts',
  )
}

async function runLegendMetaPublication(
  lease: LegendMetaPublicationLease,
  tools: JobTools,
  { statistics }: StatisticsLegendMetaPublicationJobDependencies,
): Promise<AttemptOutcome> {
  const { queue, leaseMs, retryDelayMs } = tools

  if ((await queue.renew(lease, leaseMs)) === 'lease-lost') return 'lease_lost'

  const authorization = legendMetaAuthorization(lease)
  const preflight = await statistics.preflightLegendMetaPublication(authorization)

  if (preflight === 'already-applied') return completeAttempt(queue, lease)

  if (preflight === 'effect-conflict') return deadLetterConflict(tools, lease)

  const published = await statistics.buildAndPublishLegendMeta(authorization)

  if (published.result === 'lease-lost') return 'lease_lost'

  if (published.result === 'prerequisite-missing') {
    const failure = {
      code: 'statistics_legend_meta_prerequisite_missing',
      message: 'Statistics ranked validation decision is not available yet',
      retryable: true,
    }

    return deferAttempt(queue, lease, failure, retryDelayMs)
  }

  if (published.result === 'effect-conflict') return deadLetterConflict(tools, lease)

  return completeAttempt(queue, lease)
}

export function createStatisticsLegendMetaPublicationJob(
  dependencies: StatisticsLegendMetaPublicationJobDependencies,
): JobDefinition<StatisticsLegendMetaPublicationPayload> {
  return defineJob<StatisticsLegendMetaPublicationPayload>({
    ...statisticsLegendMetaPublicationContract,
    failureCode: 'statistics_legend_meta_publication_failed',
    effectState: legendMetaPublicationEffectState,
    run: (lease, tools) => runLegendMetaPublication(lease, tools, dependencies),
  })
}
