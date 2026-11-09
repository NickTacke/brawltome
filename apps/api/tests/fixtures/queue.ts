import { proofEffectStore } from '@brawltome/accounts'
import type { Database } from '@brawltome/foundation'
import { createInteractivePlayerRefreshJob, type InteractivePlayerRefreshJobDependencies } from '@brawltome/player'
import {
  type AppliedLeaderboardEffects,
  createJobRegistry,
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  defineJob,
  type JobDefinition,
  type JobTools,
  type LeaderboardOperationKind,
  type Lease,
  type ProofEffectStore,
  type QueueWorker,
  type RefreshOperationsDatabases,
  type RunOneJobOptions,
  runOneJob,
  type SourceAdmitter,
  waitForRenewal,
} from '@brawltome/queue'
import { testJobContract } from '@brawltome/queue/testing'
import {
  createLeaderboardCollectionJob,
  defaultDeepCrawlSlicePages,
  readAppliedLeaderboardEffects,
} from '@brawltome/ranking'
import { createTelemetry } from '@brawltome/telemetry'
import { sql } from 'drizzle-orm'
import { createDeadLetterHooks } from '../../src/dead-letter-hooks'
import {
  createStatisticsJobs,
  createWorkerJobs,
  type WorkerAccountsDependencies,
  type WorkerClanDependencies,
  type WorkerDiscoveryDependencies,
  type WorkerLeaderboardDependencies,
  type WorkerPlayerDependencies,
  type WorkerStatisticsDependencies,
} from '../../src/worker/job-list'

type DiscoveryEffectChecks = WorkerDiscoveryDependencies['checks']

const noDiscoveryEffects: DiscoveryEffectChecks = {
  projectionEffectState: async () => 'none',
  reconciliationEffectApplied: async () => false,
}

const idleTelemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

const idleAccounts: WorkerAccountsDependencies = {
  accounts: { resolvePrimaryPlayerVerification: async () => ({}) as never },
  createEvidenceResolver: () => ({ resolve: async () => null }),
  primaryMonitoring: { readSnapshot: async () => ({ observedAt: new Date(0), targets: [] }) },
}

export const idlePlayerDependencies: WorkerPlayerDependencies = {
  rankedPlayers: {} as WorkerPlayerDependencies['rankedPlayers'],
  careerPlayers: {} as WorkerPlayerDependencies['careerPlayers'],
  createBrawlhallaClient: () => ({}) as ReturnType<WorkerPlayerDependencies['createBrawlhallaClient']>,
  resolveLegendReference: () => null,
  verifyName: async () => undefined,
}

export const idleStatisticsDependencies: WorkerStatisticsDependencies = {
  statistics: {} as WorkerStatisticsDependencies['statistics'],
  sourceAdmission: { admitSource: async () => ({ outcome: 'admitted' }) },
  collectEvidence: async () => {
    throw new Error('this test never collects Statistics evidence')
  },
  retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 60_000 },
}

export const idleLeaderboardDependencies: WorkerLeaderboardDependencies = {
  publication: {} as WorkerLeaderboardDependencies['publication'],
  source: {
    fetchPage: async () => {
      throw new Error('this test never reads a leaderboard page')
    },
  },
  sourceAdmission: { admitSource: async () => ({ outcome: 'admitted' }) },
  waitForSourceAdmission: waitForRenewal,
  waitForSourceRetry: waitForRenewal,
  playerNames: { applyLeaderboardNames: async () => ({ changed: 0 }) },
  rankedStandings: { applyLeaderboardRanked: async () => ({ changed: 0 }) },
  teamModes: {
    applyLeaderboardSoloQueue: async () => ({ changed: 0 }),
    applyLeaderboardTeams: async () => ({ changed: 0 }),
  },
  progress: { read: async () => null, save: async () => {} },
  slicePages: defaultDeepCrawlSlicePages,
  pageDelayMs: 0,
  retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 60_000 },
  telemetry: idleTelemetry,
}

// a real collection job over the given stores and source, for tests that run one against real tables
export function createLeaderboardTestJob(
  kind: LeaderboardOperationKind,
  overrides: Partial<WorkerLeaderboardDependencies>,
): JobDefinition<unknown> {
  return createLeaderboardCollectionJob(kind, {
    ...idleLeaderboardDependencies,
    ...overrides,
  }) as JobDefinition<unknown>
}

// the worker's four Statistics jobs, for tests that run one against real stores
export function createStatisticsTestJobs(
  statistics: WorkerStatisticsDependencies['statistics'],
  overrides: Partial<WorkerStatisticsDependencies> = {},
): JobDefinition<unknown>[] {
  return createStatisticsJobs({ ...idleStatisticsDependencies, statistics, ...overrides })
}

// the job list only runs these when a job executes, and these tests are about what the jobs tell claim
function createIdleWorkerJobs(discoveryChecks: DiscoveryEffectChecks): JobDefinition<unknown>[] {
  return createWorkerJobs({
    ranking: { expireGenerations: async () => ({ outcome: 'lease-lost' }) },
    leaderboards: idleLeaderboardDependencies,
    isRankingRetentionEnabled: true,
    telemetry: idleTelemetry,
    discovery: {
      work: {} as WorkerDiscoveryDependencies['work'],
      checks: discoveryChecks,
      playerSource: {} as WorkerDiscoveryDependencies['playerSource'],
      clanSource: {} as WorkerDiscoveryDependencies['clanSource'],
      leaseActive: async () => true,
    },
    clan: {
      clans: {} as WorkerClanDependencies['clans'],
      createBrawlhallaClient: () => ({}) as ReturnType<WorkerClanDependencies['createBrawlhallaClient']>,
    },
    accounts: idleAccounts,
    player: idlePlayerDependencies,
    statistics: idleStatisticsDependencies,
  })
}

// a job no module owns, for tests where any queued work will do
export const testJob = defineJob({
  ...testJobContract,
  failureCode: 'test_job_failed',
  async run(lease, tools) {
    const transition = await tools.queue.complete(lease)

    return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
  },
})

// the worker's proof job, with its effect write swapped so a test can make it throw or run long
export function createProofJob(commitEffect?: QueueWorker['commitProofEffect']): JobDefinition<unknown> {
  const proof = createIdleWorkerJobs(noDiscoveryEffects).find((job) => job.kind === 'proof') as JobDefinition<unknown>

  if (!commitEffect) return proof

  return { ...proof, run: (lease, tools) => proof.run(lease, withEffect(tools, commitEffect)) }
}

function withEffect(tools: JobTools, commitProofEffect: QueueWorker['commitProofEffect']): JobTools {
  return { ...tools, queue: { ...tools.queue, commitProofEffect } }
}

// leaderboard effects live in the rankings schema; a database without that module has none applied
const testReadAppliedLeaderboardEffects: AppliedLeaderboardEffects = async (transaction, effectOperationIds) => {
  const [table] = await transaction.execute<{ table: string | null }>(
    sql`SELECT to_regclass('rankings.leaderboard_effects') AS table`,
  )

  return table.table ? readAppliedLeaderboardEffects(transaction, effectOperationIds) : new Set()
}

const testProofEffectStore: ProofEffectStore = {
  ...proofEffectStore,
  async readRows(database, operationId) {
    const [{ table }] = await database.sql<
      { table: string | null }[]
    >`SELECT to_regclass('accounts.proof_effects') AS table`

    return table ? proofEffectStore.readRows(database, operationId) : []
  },
}

// built the way the worker builds it, so expired leases read the same effect tables
export function createTestQueue(databases: RefreshOperationsDatabases, discovery = noDiscoveryEffects) {
  return createPostgresRefreshOperations(databases, {
    jobs: [...createIdleWorkerJobs(discovery), testJob],
    proofEffects: testProofEffectStore,
    readAppliedLeaderboardEffects: testReadAppliedLeaderboardEffects,
  })
}

// the dead letter operations the CLI builds, with every owner's guards and effect listings
export function createTestDeadLetters(database: Database) {
  return createPostgresDeadLetterOperations(database, createDeadLetterHooks())
}

// the worker's job list with no dependencies wired, for tests about which jobs exist rather than what they do
export function createTestJobs(): JobDefinition<unknown>[] {
  return [...createIdleWorkerJobs(noDiscoveryEffects), testJob]
}

// the worker's dispatch, claiming the next due operation and running the job of its kind from the given list
export function runOneWithJobs(
  queue: QueueWorker,
  workerId: string,
  { jobs, ...options }: RunOneJobOptions & { jobs: readonly JobDefinition<unknown>[] },
): Promise<boolean> {
  return runOneJob(queue, workerId, createJobRegistry(jobs), options)
}

function scriptedRankedSnapshot(brawlhallaId: number) {
  return {
    name: 'Scripted Player',
    brawlhalla_id: brawlhallaId,
    rating: 1000,
    peak_rating: 1000,
    tier: 'Gold 1',
    wins: 1,
    games: 2,
    region: 'US-E',
    global_rank: 100,
    region_rank: 20,
    legends: [],
    '2v2': [],
  }
}

function scriptedCareerSnapshot(brawlhallaId: number) {
  return {
    brawlhalla_id: brawlhallaId,
    name: 'Scripted Player',
    xp: 1,
    level: 1,
    xp_percentage: 0,
    games: 2,
    wins: 1,
    damagebomb: '0',
    damagemine: '0',
    damagespikeball: '0',
    damagesidekick: '0',
    hitsnowball: 0,
    kobomb: 0,
    komine: 0,
    kospikeball: 0,
    kosidekick: 0,
    kosnowball: 0,
    legends: [],
  }
}

// the real player refresh job with its stores stubbed, so a test can script what a section does at the source
export function createScriptedPlayerRefreshJob(
  runSection: (
    lease: Lease<unknown>,
    section: 'ranked' | 'stats',
    admitSource: SourceAdmitter,
  ) => Promise<void> = async () => undefined,
): JobDefinition<unknown> {
  let currentLease: Lease<unknown> | undefined

  const dependencies: InteractivePlayerRefreshJobDependencies = {
    rankedPlayers: {
      applySnapshot: async () => 'applied',
      recordChecked: async () => 'no-op',
    } as unknown as InteractivePlayerRefreshJobDependencies['rankedPlayers'],
    careerPlayers: {
      applySnapshot: async () => 'applied',
      recordChecked: async () => 'no-op',
    } as unknown as InteractivePlayerRefreshJobDependencies['careerPlayers'],
    createAdmittedSource: (admitSource) => ({
      getRanked: async (brawlhallaId, options) => {
        options.onAttempt()
        await runSection(currentLease as Lease<unknown>, 'ranked', admitSource)

        return scriptedRankedSnapshot(brawlhallaId)
      },
      getStats: async (brawlhallaId, options) => {
        options.onAttempt()
        await runSection(currentLease as Lease<unknown>, 'stats', admitSource)

        return scriptedCareerSnapshot(brawlhallaId)
      },
    }),
    isPrimaryMonitoringTarget: async () => true,
    resolveLegendReference: () => null,
  }

  const job = createInteractivePlayerRefreshJob(dependencies) as JobDefinition<unknown>

  return defineJob<unknown>({
    ...job,
    run(lease, tools) {
      currentLease = lease

      return job.run(lease, tools)
    },
  })
}
