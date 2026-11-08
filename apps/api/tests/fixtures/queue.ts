import {
  type AdmissionConfig,
  createEffectStates,
  createPostgresRefreshOperations,
  type JobDefinition,
  type RefreshOperationsDatabases,
} from '@brawltome/refresh-operations'
import { createTelemetry } from '@brawltome/telemetry'
import { createJobsFromOptions } from '../../src/refresh-operations-worker'
import { createWorkerJobs, type WorkerDiscoveryDependencies } from '../../src/worker/job-list'

type DiscoveryEffectChecks = WorkerDiscoveryDependencies['checks']

const noDiscoveryEffects: DiscoveryEffectChecks = {
  projectionEffectState: async () => 'none',
  reconciliationEffectApplied: async () => false,
}

const idleTelemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

// the job list only runs these when a job executes, and these tests are about what the jobs tell claim
function createIdleWorkerJobs(discoveryChecks: DiscoveryEffectChecks): JobDefinition<unknown>[] {
  return createWorkerJobs({
    ranking: { expireGenerations: async () => ({ outcome: 'lease-lost' }) },
    isRankingRetentionEnabled: true,
    telemetry: idleTelemetry,
    discovery: {
      work: {} as WorkerDiscoveryDependencies['work'],
      checks: discoveryChecks,
      playerSource: {} as WorkerDiscoveryDependencies['playerSource'],
      clanSource: {} as WorkerDiscoveryDependencies['clanSource'],
      leaseActive: async () => true,
    },
  })
}

// built the way the worker builds it, so expired leases read the same effect tables
export function createTestQueue(databases: RefreshOperationsDatabases, discovery = noDiscoveryEffects) {
  return createPostgresRefreshOperations(databases, {
    effectStates: createEffectStates(createIdleWorkerJobs(discovery)),
  })
}

const jobListAdmission: AdmissionConfig = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 5,
    leaderboard: 4,
    'global-statistics': 3,
    projection: 2,
    maintenance: 1,
  },
}

// the worker's job list with no dependencies wired, for tests about which jobs exist rather than what they do
export function createTestJobs(): JobDefinition<unknown>[] {
  return createJobsFromOptions({
    leaseMs: 30_000,
    retryDelayMs: 1_000,
    admission: jobListAdmission,
    movedJobs: createIdleWorkerJobs(noDiscoveryEffects),
  })
}
