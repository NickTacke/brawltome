import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeRefreshOperations } from './migrations/0001-initialize-operations'
import { addSchedulingAndAdmission } from './migrations/0002-add-scheduling-and-admission'
import { addInteractiveRefreshReservations } from './migrations/0003-interactive-refresh-reservations'
import { addInteractiveRefreshCheckpoints } from './migrations/0004-add-interactive-checkpoints'
import { addLeaderboardOperationKind } from './migrations/0005-add-leaderboard-kind'
import { exposeActiveLeaseFence } from './migrations/0006-expose-active-lease-fence'
import { addClanRefresh } from './migrations/0007-add-clan-refresh'
import { addDeadLetterOperations } from './migrations/0008-add-dead-letter-operations'
import { addLeaderboardOperationModes } from './migrations/0009-add-leaderboard-modes'
import { addPlayerDiscoveryProjection } from './migrations/0010-add-player-discovery-projection'
import { addRankedPlayerPulseOperation } from './migrations/0011-add-ranked-player-pulse'
import { addPrimaryPlayerMonitoring } from './migrations/0012-add-primary-player-monitoring'
import { addDiscoveryOperations } from './migrations/0013-add-discovery-operations'
import { addStatisticsCollection } from './migrations/0014-add-statistics-collection'
import { addStatisticsPublication } from './migrations/0015-add-statistics-publication'
import { addLegendMetaPublication } from './migrations/0016-add-legend-meta-publication'
import { addPlayerNameVerification } from './migrations/0017-add-player-name-verification'
import { addRankingRetention } from './migrations/0018-add-ranking-retention'
import { validateRankingRetentionChecks } from './migrations/0019-validate-ranking-retention-checks'
import { allowRecentlyViewedRefresh } from './migrations/0020-allow-recently-viewed-refresh'
import { validateRecentlyViewedRefresh } from './migrations/0021-validate-recently-viewed-refresh'
import { addLeaderboardDeepCrawl } from './migrations/0022-add-leaderboard-deep-crawl'
import { validateLeaderboardDeepCrawl } from './migrations/0023-validate-leaderboard-deep-crawl'
import { addDeepCrawlModes } from './migrations/0024-add-deep-crawl-modes'
import { validateDeepCrawlModes } from './migrations/0025-validate-deep-crawl-modes'
import { notifyPlayerRefreshSettled } from './migrations/0026-notify-player-refresh-settled'

export { validateAdmissionConfig } from './domain/admission'
export {
  type DeferCategory,
  decideExecutionFailure,
  decideSourceFailure,
  type FailureDecision,
  type RetryTimings,
  retryDelayForAttempt,
  sourceWaitMs,
} from './domain/failure-decision'
export {
  failureDetails,
  JobLeaseLostError,
  SourceAdmissionLimitedError,
  type SourceDomain,
  sourceRetryAfterMs,
} from './domain/job-errors'
export {
  type AttemptOutcome,
  defineJob,
  type EffectState,
  type JobDefinition,
  type JobTools,
  type Lease,
  type LeaseOperations,
  type LeaseWatcher,
  type QueueWorker,
  type SourceAdmissionPort,
  type SourceAdmitter,
} from './jobs/job-definition'
export { createJobRegistry, type JobRegistry } from './jobs/job-registry'
export { waitForRenewal } from './jobs/lease-renewal'
export { type RetryBackoff, type RunOneJobOptions, runOneJob } from './jobs/run-one-job'
export { type RunSectionsOptions, runSections, type SectionRun } from './jobs/run-sections'
export {
  acquireActiveLease,
  commitInteractiveSection,
  completeRankingRetentionLease,
  type HeldLeaderboardLease,
  type HeldLease,
  type LeaderboardEffectResult,
  lockActiveLeaderboardLease,
  lockActiveRankingRetentionLease,
  recordLeaderboardEffect,
} from './lease-fences'
export * from './model'
export {
  createPostgresDeadLetterOperations,
  createPostgresRefreshOperations,
  type PostgresRefreshOperations,
  type RefreshOperationsDatabases,
} from './postgres'

const migrations = [
  initializeRefreshOperations,
  addSchedulingAndAdmission,
  addInteractiveRefreshReservations,
  addInteractiveRefreshCheckpoints,
  addLeaderboardOperationKind,
  exposeActiveLeaseFence,
  addClanRefresh,
  addDeadLetterOperations,
  addLeaderboardOperationModes,
  addPlayerDiscoveryProjection,
  addRankedPlayerPulseOperation,
  addPrimaryPlayerMonitoring,
  addDiscoveryOperations,
  addStatisticsCollection,
  addStatisticsPublication,
  addLegendMetaPublication,
  addPlayerNameVerification,
  addRankingRetention,
  validateRankingRetentionChecks,
  allowRecentlyViewedRefresh,
  validateRecentlyViewedRefresh,
  addLeaderboardDeepCrawl,
  validateLeaderboardDeepCrawl,
  addDeepCrawlModes,
  validateDeepCrawlModes,
  notifyPlayerRefreshSettled,
] as const

export const refreshOperationsModule = {
  name: 'refresh-operations',
  // 0016 reads statistics tables, but only statistics calls it; declaring it would be a cycle
  dependsOn: [],
  migrations,
} satisfies BrawltomeModule
