import type {
  CohortCandidateSnapshot,
  LaunchCohortBracket,
  LaunchCohortCapacityEnvelope,
  LaunchCohortRegion,
} from './cohort'
import type { CellCollectionProgress, PublicationDecisionEvidence, PublicationProduct } from './publication'
import type { LifetimeEvidence, RankedEvidence } from './source'

export {
  FULL_LAUNCH_COHORT_METHODOLOGY_VERSION,
  LAUNCH_COHORT_BRACKET,
  LAUNCH_COHORT_CAP,
  LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST,
  LAUNCH_COHORT_METHODOLOGY_VERSION,
  LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS,
  LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS,
  LAUNCH_COHORT_REGION,
  LAUNCH_COHORT_REQUESTS_PER_PLAYER,
  LAUNCH_COHORT_SOURCE_QUOTA_UNITS,
  LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS,
  type CohortCandidateSnapshot,
  type LaunchCohortBracket,
  type LaunchCohortCapacityEnvelope,
  type LaunchCohortRegion,
  type SelectedCohortMember,
  type SelectedFullLaunchCohort,
  type SelectedLaunchCohort,
  launchCohortBrackets,
  launchCohortRegions,
  selectFullLaunchCohort,
  selectLaunchCohort,
  selectLaunchCohortCell,
} from './cohort'
export {
  type AuditedCellCollectionProgress,
  type CellCollectionProgress,
  type PublicationDecisionEvidence,
  type PublicationProduct,
  type PublicationValidationReason,
  validatePublicationDecision,
} from './publication'

export type CollectionProduct = PublicationProduct
export type StatisticsCollectionKind = 'statistics-ranked-collection' | 'statistics-lifetime-collection'
export type StatisticsPublicationKind = 'statistics-publication'

export type CollectionAuthorization = {
  operationId: string
  effectOperationId: string
  operationKey: string
  kind: StatisticsCollectionKind
  leaseOwner: string
  leaseToken: number
  cohortId: string
  brawlhallaId: number
}

export type CollectionAttemptAuthorization = CollectionAuthorization & { attemptNumber: number }

export type PublicationAuthorization = {
  operationId: string
  effectOperationId: string
  operationKey: string
  kind: StatisticsPublicationKind
  leaseOwner: string
  leaseToken: number
  generationId: string
  product: PublicationProduct
}

export type CollectionObservation =
  | {
      authorization: CollectionAuthorization & { kind: 'statistics-ranked-collection' }
      evidence: RankedEvidence
      observedAt?: Date
    }
  | {
      authorization: CollectionAuthorization & { kind: 'statistics-lifetime-collection' }
      evidence: LifetimeEvidence
      observedAt?: Date
    }

export type { LifetimeEvidence, RankedEvidence } from './source'

export type CohortCollectionIntent = {
  cohortId: string
  brawlhallaId: number
  product: CollectionProduct
  kind: StatisticsCollectionKind
  operationKey: string
}

export type PublicationIntent = {
  generationId: string
  product: PublicationProduct
  kind: StatisticsPublicationKind
  operationKey: string
}

export type CohortMemberAudit = {
  brawlhallaId: number
  sourceRating: number
  ordinal: number
  selectionHash: string
  rankedOperationId: string | null
  lifetimeOperationId: string | null
  rankedSucceededAt: string | null
  lifetimeSucceededAt: string | null
}

export type CohortAudit = {
  cohortId: string
  methodologyVersion: string
  sourceSnapshotId: string
  sourceGenerationId: string
  sourceObservedAt: string
  region: 'EU'
  bracket: 'Diamond+'
  cap: 750
  minimumEvidencePlayers: 125
  eligiblePlayers: number
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  members: CohortMemberAudit[]
}

export type LaunchCellAudit = {
  cohortId: string
  sourceSnapshotId: string
  region: LaunchCohortRegion
  bracket: LaunchCohortBracket
  cap: 750
  minimumEvidencePlayers: 125
  eligiblePlayers: number
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  members: CohortMemberAudit[]
}

export type PublicationDecisionAudit = PublicationDecisionEvidence & {
  decisionId: string
  effectOperationId: string
  operationKey: string
  decidedAt: string
}

export type ProductCollectionProgressAudit = {
  product: CollectionProduct
  selectedPlayers: number
  operations: number
  sourceAttempts: number
  successes: number
  cells: CellCollectionProgress[]
}

export type LaunchCohortAudit = {
  generationId: string
  methodologyVersion: string
  sourceGenerationId: string
  sourceObservedAt: string
  observationWindow: { startsAt: string; endsAt: string }
  capacityEnvelope: LaunchCohortCapacityEnvelope
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  cells: LaunchCellAudit[]
  progress: Record<CollectionProduct, ProductCollectionProgressAudit>
  decisions: PublicationDecisionAudit[]
}

export type PublicationStatus = {
  product: PublicationProduct
  active: PublicationDecisionAudit | null
  latestDecision: PublicationDecisionAudit
  stale: boolean
}

export type StatisticsReconciliationState = {
  legacyCohortExists: boolean
  launch: {
    generationId: string
    sourceGenerationId: string
    decisionCount: number
    cohortIds: string[]
  } | null
}

export type CollectionCommitResult = 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'
export type CollectionAttemptResult =
  | 'recorded'
  | 'already-recorded'
  | 'capacity-exceeded'
  | 'effect-conflict'
  | 'lease-lost'
export type CollectionAttemptPreflightResult = 'allowed' | 'capacity-exceeded' | 'effect-conflict' | 'lease-lost'
export type CollectionPreflightResult = 'missing' | 'already-applied' | 'effect-conflict'
export type PublicationCommitResult = CollectionCommitResult | 'collection-active'

export interface LegacyCohortReconciliation {
  reconcileCohort(snapshot: CohortCandidateSnapshot): Promise<CohortAudit>
  getCohort(): Promise<CohortAudit | null>
}

export interface LaunchCohortReconciliation {
  reconcileLaunchCohort(snapshots: readonly CohortCandidateSnapshot[]): Promise<LaunchCohortAudit>
  getLaunchCohort(generationId?: string): Promise<LaunchCohortAudit | null>
  reconciliationState(): Promise<StatisticsReconciliationState>
}

export interface StatisticsCollectionStore {
  collectionIntents(limit?: number): Promise<CohortCollectionIntent[]>
  boundCollectionOperationIds(operationIds: readonly string[]): Promise<string[]>
  recordCollectionOperation(intent: CohortCollectionIntent, operationId: string): Promise<void>
  preflightCollectionAttempt(authorization: CollectionAttemptAuthorization): Promise<CollectionAttemptPreflightResult>
  recordCollectionAttempt(authorization: CollectionAttemptAuthorization): Promise<CollectionAttemptResult>
  preflightCollection(authorization: CollectionAuthorization): Promise<CollectionPreflightResult>
  commitObservation(observation: CollectionObservation): Promise<CollectionCommitResult>
}

export interface StatisticsPublicationStore {
  publicationIntents(): Promise<PublicationIntent[]>
  boundPublicationOperationIds(operationIds: readonly string[]): Promise<string[]>
  recordPublicationOperation(intent: PublicationIntent, operationId: string): Promise<'recorded' | 'collection-active'>
  preflightPublication(authorization: PublicationAuthorization): Promise<CollectionPreflightResult>
  validateAndPublish(authorization: PublicationAuthorization): Promise<{
    result: PublicationCommitResult
    decision: PublicationDecisionAudit | null
  }>
  getPublication(product: PublicationProduct): Promise<PublicationStatus | null>
}

export type StatisticsTracer = LegacyCohortReconciliation &
  LaunchCohortReconciliation &
  StatisticsCollectionStore &
  StatisticsPublicationStore
