import type {
  CohortCandidateSnapshot,
  LaunchCohortBracket,
  LaunchCohortCapacityEnvelope,
  LaunchCohortRegion,
} from './cohort'
import type {
  LegendMetaArtifact,
  LegendMetaArtifactSlice,
  LegendMetaFilterBracket,
  LegendMetaFilterRegion,
} from './legend-meta'
import type { CellCollectionProgress, PublicationDecisionEvidence, PublicationProduct } from './publication'
import type { LifetimeEvidence, RankedEvidence } from './source'
import type { CAREER_WEAPON_USAGE_METHODOLOGY_VERSION, CareerWeaponUsageAggregate } from './weapon-usage'

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
  LEGEND_META_METHODOLOGY_DISCLOSURE,
  LEGEND_META_METHODOLOGY_VERSION,
  LEGEND_META_MINIMUM_GAMES,
  LEGEND_META_MINIMUM_PLAYERS,
  type ExactRatio,
  type LegendMetaArtifact,
  type LegendMetaArtifactSlice,
  type LegendMetaFilterBracket,
  type LegendMetaFilterRegion,
  type LegendMetaLegend,
  type LegendMetaObservedPlayer,
  type LegendMetaRow,
  type WilsonInterval,
  buildLegendMetaArtifact,
} from './legend-meta'
export {
  type AuditedCellCollectionProgress,
  type CellCollectionProgress,
  type PublicationDecisionEvidence,
  type PublicationProduct,
  type PublicationValidationReason,
  validatePublicationDecision,
} from './publication'
export {
  CAREER_WEAPON_MIN_AGGREGATE_HELD_SECONDS,
  CAREER_WEAPON_MIN_CONTRIBUTORS,
  CAREER_WEAPON_USAGE_METHODOLOGY_VERSION,
  CAREER_WEAPON_MIN_PLAYER_HELD_SECONDS,
  CareerWeaponUsageValidationError,
  aggregateCareerWeaponUsage,
  exactRatio,
  type CareerWeaponComparisonReason,
  type CareerWeaponUsageAggregate,
  type CareerWeaponUsageRow,
  type CareerWeaponExactRatio,
} from './weapon-usage'

export type CollectionProduct = PublicationProduct
export type StatisticsCollectionKind = 'statistics-ranked-collection' | 'statistics-lifetime-collection'
export type StatisticsPublicationKind = 'statistics-publication'
export type StatisticsLegendMetaPublicationKind = 'statistics-legend-meta-publication'

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

export type LegendMetaPublicationAuthorization = {
  operationId: string
  effectOperationId: string
  operationKey: string
  kind: StatisticsLegendMetaPublicationKind
  leaseOwner: string
  leaseToken: number
  generationId: string
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

export type LegendMetaPublicationIntent = {
  generationId: string
  kind: StatisticsLegendMetaPublicationKind
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

export type LegendMetaPublicationReason =
  | { code: 'ranked-publication-rejected' }
  | { code: 'duplicate-player-across-cells' }
  | { code: 'unknown-legend'; legendId: number }
  | { code: 'invalid-ranked-observation' }

export type LegendMetaPublicationDecisionAudit = {
  decisionId: string
  generationId: string
  effectOperationId: string
  operationKey: string
  outcome: 'accepted' | 'rejected'
  reasons: LegendMetaPublicationReason[]
  decidedAt: string
  snapshotId: string | null
}

export type LegendMetaUnavailable = {
  status: 'unavailable'
  reason: 'not-yet-published'
  region: LegendMetaFilterRegion
  bracket: LegendMetaFilterBracket
}

export type LegendMetaAvailable = Omit<LegendMetaArtifact, 'slices'> & {
  status: 'fresh' | 'stale'
  staleReason: 'latest-build-failed' | 'publication-overdue' | null
  region: LegendMetaFilterRegion
  bracket: LegendMetaFilterBracket
  slice: LegendMetaArtifactSlice
}

export type LegendMetaQueryResult = LegendMetaUnavailable | LegendMetaAvailable

export interface StatisticsQueries {
  getLegendMeta(input: {
    region: LegendMetaFilterRegion
    bracket: LegendMetaFilterBracket
  }): Promise<LegendMetaQueryResult>
}

export type CareerWeaponUsageFilters = {
  region: 'all' | LaunchCohortRegion
  bracket: 'all' | LaunchCohortBracket
}

export type CareerWeaponUsageView =
  | {
      status: 'unavailable'
      reason: 'not-yet-published'
      filters: CareerWeaponUsageFilters
    }
  | (CareerWeaponUsageAggregate & {
      status: 'fresh' | 'stale'
      snapshotId: string
      generationId: string
      cohortMethodologyVersion: string
      methodologyVersion: typeof CAREER_WEAPON_USAGE_METHODOLOGY_VERSION
      observationWindow: { startsAt: string; endsAt: string }
      publishedAt: string
      expectedNextPublicationAt: string
      filters: CareerWeaponUsageFilters
      staleReasons: Array<'newer-publication-rejected' | 'weekly-publication-overdue'>
      latestDecision: PublicationDecisionAudit
    })

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
export type LegendMetaPublicationCommitResult = CollectionCommitResult | 'prerequisite-missing'

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

export interface StatisticsLegendMetaPublicationStore {
  legendMetaPublicationIntents(): Promise<LegendMetaPublicationIntent[]>
  boundLegendMetaPublicationOperationIds(operationIds: readonly string[]): Promise<string[]>
  recordLegendMetaPublicationOperation(intent: LegendMetaPublicationIntent, operationId: string): Promise<void>
  preflightLegendMetaPublication(authorization: LegendMetaPublicationAuthorization): Promise<CollectionPreflightResult>
  buildAndPublishLegendMeta(authorization: LegendMetaPublicationAuthorization): Promise<{
    result: LegendMetaPublicationCommitResult
    decision: LegendMetaPublicationDecisionAudit | null
  }>
}

export interface CareerWeaponUsageQueries {
  getCareerWeaponUsage(filters: CareerWeaponUsageFilters): Promise<CareerWeaponUsageView>
}

export type StatisticsTracer = LegacyCohortReconciliation &
  LaunchCohortReconciliation &
  StatisticsCollectionStore &
  StatisticsPublicationStore &
  StatisticsLegendMetaPublicationStore &
  StatisticsQueries &
  CareerWeaponUsageQueries
