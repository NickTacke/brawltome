import { createRankingRetentionJob, type RankingRetentionStore } from '@brawltome/ranking'
import type { JobDefinition } from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'

export type WorkerJobDependencies = {
  ranking: RankingRetentionStore
  isRankingRetentionEnabled: boolean
  telemetry: Telemetry
}

// the jobs that live in their owning module; the rest are still wrapped in refresh-operations-worker.ts
export function createWorkerJobs(dependencies: WorkerJobDependencies): JobDefinition<unknown>[] {
  const rankingRetention = createRankingRetentionJob({
    store: dependencies.ranking,
    isEnabled: dependencies.isRankingRetentionEnabled,
    telemetry: dependencies.telemetry,
  })

  return [rankingRetention]
}
