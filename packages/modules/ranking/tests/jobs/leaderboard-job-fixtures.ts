import type { AttemptOutcome, JobDefinition, LeaderboardOperationKind, QueueWorker } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import {
  createLeaderboardCollectionJob,
  type LeaderboardCollectionJobDependencies,
} from '../../jobs/leaderboard-collection-job'
import {
  createLeaderboardDeepCrawlJob,
  defaultDeepCrawlSlicePages,
  type LeaderboardDeepCrawlJobDependencies,
} from '../../jobs/leaderboard-deep-crawl-job'

export type LeaderboardJobOverrides = Partial<
  LeaderboardCollectionJobDependencies & LeaderboardDeepCrawlJobDependencies
>

const idleTelemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

const leaderboardJobRetryTimings = { retryDelayMs: 10, sourceUnavailableRetryMs: 60_000 }

function idleDependencies(): LeaderboardCollectionJobDependencies & LeaderboardDeepCrawlJobDependencies {
  return {
    source: {
      fetchPage: async () => {
        throw new Error('this test never reads a leaderboard page')
      },
    },
    sourceAdmission: { admitSource: async () => ({ outcome: 'admitted' }) },
    waitForSourceAdmission: async () => {},
    waitForSourceRetry: async () => {},
    telemetry: idleTelemetry,
    publication: {
      publishGeneration: async () => 'published',
      recordCollectionFailure: async () => 'recorded',
    },
    playerNames: { applyLeaderboardNames: async () => ({ changed: 0 }) },
    rankedStandings: { applyLeaderboardRanked: async () => ({ changed: 0 }) },
    teamModes: {
      applyLeaderboardSoloQueue: async () => ({ changed: 0 }),
      applyLeaderboardTeams: async () => ({ changed: 0 }),
    },
    progress: { read: async () => null, save: async () => {} },
    slicePages: defaultDeepCrawlSlicePages,
    pageDelayMs: 0,
    retryTimings: leaderboardJobRetryTimings,
  }
}

export function createTestLeaderboardJob(
  kind: string,
  overrides: LeaderboardJobOverrides = {},
): JobDefinition<unknown> {
  const dependencies = { ...idleDependencies(), ...overrides }

  if (kind === 'leaderboard-deep-crawl') return createLeaderboardDeepCrawlJob(dependencies) as JobDefinition<unknown>

  return createLeaderboardCollectionJob(kind as LeaderboardOperationKind, dependencies) as JobDefinition<unknown>
}

// claims the given lease through the queue and runs the leaderboard job of its kind on it
export function runLeaderboardJobOnce(
  operations: unknown,
  lease: { kind: string },
  overrides: LeaderboardJobOverrides = {},
): Promise<AttemptOutcome> {
  const job = createTestLeaderboardJob(lease.kind, overrides)

  return runJobOnce(operations as QueueWorker, job, {
    leaseMs: 1_000,
    retryDelayMs: 10,
    telemetry: overrides.telemetry,
  })
}
