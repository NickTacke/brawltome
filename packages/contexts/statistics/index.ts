import type { CohortCandidateSnapshot } from './cohort'
import type { LifetimeEvidence, RankedEvidence } from './source'

export {
  LAUNCH_COHORT_BRACKET,
  LAUNCH_COHORT_CAP,
  LAUNCH_COHORT_METHODOLOGY_VERSION,
  LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS,
  LAUNCH_COHORT_REGION,
  type CohortCandidateSnapshot,
  type SelectedCohortMember,
  type SelectedLaunchCohort,
  selectLaunchCohort,
} from './cohort'

export type CollectionProduct = 'ranked' | 'lifetime'
export type StatisticsCollectionKind = 'statistics-ranked-collection' | 'statistics-lifetime-collection'

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
  members: Array<{
    brawlhallaId: number
    sourceRating: number
    ordinal: number
    selectionHash: string
    rankedOperationId: string | null
    lifetimeOperationId: string | null
    rankedSucceededAt: string | null
    lifetimeSucceededAt: string | null
  }>
}

export type CollectionCommitResult = 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'
export type CollectionPreflightResult = 'missing' | 'already-applied' | 'effect-conflict'

export interface StatisticsTracer {
  reconcileCohort(snapshot: CohortCandidateSnapshot): Promise<CohortAudit>
  collectionIntents(): Promise<CohortCollectionIntent[]>
  recordCollectionOperation(intent: CohortCollectionIntent, operationId: string): Promise<void>
  preflightCollection(authorization: CollectionAuthorization): Promise<CollectionPreflightResult>
  commitObservation(observation: CollectionObservation): Promise<CollectionCommitResult>
  getCohort(): Promise<CohortAudit | null>
}
