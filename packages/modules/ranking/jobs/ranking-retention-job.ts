import {
  type AttemptOutcome,
  defineJob,
  type JobDefinition,
  type JobTools,
  type Lease,
} from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'
import type { RankingRetentionInput, RankingRetentionStore } from '../retention'
import { rankingRetentionContract } from './ranking-retention-contract'

export type RankingRetentionJobDependencies = {
  store: RankingRetentionStore
  // false pauses retention: runs already materialized complete without deleting anything
  isEnabled: boolean
  telemetry: Telemetry
}

async function completeWithoutExpiring(
  lease: Lease<RankingRetentionInput>,
  tools: JobTools,
  telemetry: Telemetry,
): Promise<AttemptOutcome> {
  const transition = await tools.queue.complete(lease)

  if (transition === 'lease-lost') return 'lease_lost'

  try {
    telemetry.logger.info('ranking.retention.skipped', {
      operationId: lease.operationId,
      reason: 'disabled',
      deletedGenerations: 0,
    })
  } catch {
    // telemetry never decides the outcome of committed work
  }

  return 'succeeded'
}

function recordExpired(
  telemetry: Telemetry,
  lease: Lease<RankingRetentionInput>,
  result: { deletedGenerations: number; expirableGenerations: number },
  durationMs: number,
): void {
  try {
    telemetry.metrics.add('ranking_retention_deleted_generations_total', result.deletedGenerations, {})
    telemetry.metrics.set('ranking_retention_expirable_generations', result.expirableGenerations, {})
    telemetry.metrics.observe('ranking_retention_duration_ms', durationMs, {})

    telemetry.logger.info('ranking.retention.completed', {
      operationId: lease.operationId,
      deletedGenerations: result.deletedGenerations,
      retentionHours: lease.payload.retentionHours,
      maxGenerations: lease.payload.maxGenerations,
      // a full batch means more expired generations are waiting for the next run
      batchFull: result.deletedGenerations >= lease.payload.maxGenerations,
      expirableGenerations: result.expirableGenerations,
      durationMs,
    })
  } catch {
    // telemetry never decides the outcome of committed work
  }
}

// expires one bounded batch of old leaderboard generations; the lease check, the delete and the operation's
// completion commit in one transaction, so a batch that outlives its lease is still recorded as succeeded
export function createRankingRetentionJob(
  dependencies: RankingRetentionJobDependencies,
): JobDefinition<RankingRetentionInput> {
  const { store, isEnabled, telemetry } = dependencies

  return defineJob<RankingRetentionInput>({
    ...rankingRetentionContract,
    failureCode: 'ranking_retention_failed',
    async run(lease, tools) {
      if (!isEnabled) return completeWithoutExpiring(lease, tools, telemetry)

      if ((await tools.queue.renew(lease, tools.leaseMs)) === 'lease-lost') return 'lease_lost'

      const startedAt = performance.now()

      const result = await store.expireGenerations(
        { operationId: lease.operationId, leaseOwner: lease.leaseOwner, leaseToken: lease.leaseToken },
        lease.payload,
      )

      if (result.outcome === 'lease-lost') return 'lease_lost'

      recordExpired(telemetry, lease, result, Math.round(performance.now() - startedAt))

      return 'succeeded'
    },
  })
}
