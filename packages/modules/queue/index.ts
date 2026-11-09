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
import { addPrimaryPlayerVerificationKind } from './migrations/0027-add-primary-player-verification-kind'
import { validatePrimaryPlayerVerificationKind } from './migrations/0028-validate-primary-player-verification-kind'
import { dropKindConstraints } from './migrations/0029-drop-kind-constraints'
import { dropScheduleKindConstraints } from './migrations/0030-drop-schedule-kind-constraints'
import { dropInteractiveSectionCheck } from './migrations/0031-drop-interactive-section-check'
import { renameSchemaToQueue } from './migrations/0032-rename-schema-to-queue'

export { type AcceptOperationInput, acceptOperation } from './db/accept-operation'
export {
  type ActivateAdmittedInput,
  type ActivateBoundOptions,
  type ActivateReservedInput,
  activateAdmitted,
  activateBound,
  activateReserved,
  type RejectExpiredInput,
  type RejectReservedInput,
  rejectExpired,
  rejectReserved,
} from './db/activate-operation'
export { lockEffectOperation } from './db/collection-seal'
export type {
  DeadLetterEffects,
  DeadLetterHooks,
  EffectDescriber,
  ReplayGuard,
  ReplayGuardTarget,
} from './db/dead-letter-hooks'
export { type DisableFixedScheduleInput, disableFixedSchedule } from './db/disable-fixed-schedule'
export {
  type EffectLineage,
  type OperationIdentity,
  operationMatches,
  readEffectLineage,
} from './db/effect-lineage'
export {
  type ActiveOperation,
  type CountActiveInput,
  countActive,
  type FindActiveOperationInput,
  findActiveOperation,
  type ListAwaitingInput,
  listAwaiting,
} from './db/find-operations'
export type { AppliedLeaderboardEffects } from './db/materialize-due-schedules'
export { createPostgresDeadLetterOperations } from './db/postgres-dead-letters'
export {
  createPostgresRefreshOperations,
  type PostgresRefreshOperations,
  type RefreshOperationsDatabases,
} from './db/postgres-queue'
export { type PromotePendingWorkClassInput, promotePendingWorkClass } from './db/promote-work-class'
export {
  type AttemptHistory,
  type ReadAttemptHistoryInput,
  readAttemptHistory,
} from './db/read-attempt-history'
export { readInteractiveEffects } from './db/read-effect-rows'
export {
  type FixedSchedule,
  type ReconcileFixedScheduleInput,
  reconcileFixedSchedule,
} from './db/reconcile-fixed-schedule'
export {
  type ReconcileObservationWatermark,
  type ReconcileResourceSchedulesInput,
  type ReconcileResourceSchedulesResult,
  type ResourceSchedule,
  reconcileResourceSchedules,
} from './db/reconcile-resource-schedules'
export {
  type ReserveForAdmissionInput,
  type ReserveForAdmissionOptions,
  type ReserveForBindingInput,
  reserveForAdmission,
  reserveForBinding,
} from './db/reserve-operation'
export { allSectionsCommitted, sectionCommitted } from './db/section-checkpoints'
export type { Transaction } from './db/transaction'
export { validateAdmissionConfig } from './domain/admission'
export {
  type DeferCategory,
  decideCountedSourceOutage,
  decideExecutionFailure,
  decideSourceFailure,
  type FailureDecision,
  isSourceFailure,
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
  hasOnlyFields,
  isPositive32BitInteger,
  isPositiveInteger,
  isSectionList,
  readPayloadObject,
} from './domain/payload-fields'
export {
  completeWithProofEffect,
  type ProofEffectPayload,
  type ProofEffectStore,
  type ProofEffectWrite,
  type ProofEffectWriteResult,
} from './jobs/complete-with-proof-effect'
export {
  type AttemptOutcome,
  defineJob,
  type EffectState,
  type JobContract,
  type JobDefinition,
  type JobTools,
  type Lease,
  type LeaseOperations,
  type LeaseWatcher,
  type QueueWorker,
  type SourceAdmissionPort,
  type SourceAdmitter,
} from './jobs/job-definition'
export { assertValidJobInput } from './jobs/job-input'
export { createJobRegistry, type JobRegistry } from './jobs/job-registry'
export { waitForRenewal } from './jobs/lease-renewal'
export { parseProofEffectPayload, proofContract } from './jobs/proof-contract'
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
} from './lease-fences'
export * from './model'
export { authenticateDeadLetterOperator, OperatorAuthenticationError } from './operator-auth'

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
  addPrimaryPlayerVerificationKind,
  validatePrimaryPlayerVerificationKind,
  dropKindConstraints,
  dropScheduleKindConstraints,
  dropInteractiveSectionCheck,
  renameSchemaToQueue,
] as const

export type { InvalidRow } from './db/claim-operation'

export const queueModule = {
  name: 'queue',
  // migration identities keep the refresh-operations prefix because every migrated database records them
  // 0016 reads statistics tables, but only statistics calls it; declaring it would be a cycle
  dependsOn: [],
  migrations,
} satisfies BrawltomeModule
