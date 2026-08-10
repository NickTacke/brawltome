import { createHash } from 'node:crypto'
import { type CurrentOneVsOneBracket, currentOneVsOneBracket } from '@brawltome/game-data'

export const LAUNCH_COHORT_REGION = 'EU' as const
export const LAUNCH_COHORT_BRACKET = 'Diamond+' as const
export const LAUNCH_COHORT_CAP = 750
export const LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS = 125
export const LAUNCH_COHORT_METHODOLOGY_VERSION = 'eu-diamond-tracer-v1'
export const FULL_LAUNCH_COHORT_METHODOLOGY_VERSION = 'full-launch-cohort-v1'
export const launchCohortRegions = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export const launchCohortBrackets = ['Platinum', 'Diamond+'] as const satisfies readonly CurrentOneVsOneBracket[]
export const LAUNCH_COHORT_SOURCE_QUOTA_UNITS = 150
export const LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS = 15 * 60
export const LAUNCH_COHORT_REQUESTS_PER_PLAYER = 2
export const LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST = 3
export const LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS = 7 * 24 * 60 * 60

export type LaunchCohortRegion = (typeof launchCohortRegions)[number]
export type LaunchCohortBracket = (typeof launchCohortBrackets)[number]

export type CohortCandidateSnapshot = {
  snapshotId: string
  generationId: string
  observedAt: string
  region: LaunchCohortRegion
  mode: '1v1'
  candidates: Array<{ brawlhallaId: number; rating: number }>
}

export type SelectedCohortMember = {
  brawlhallaId: number
  sourceRating: number
  ordinal: number
  selectionHash: string
}

export type SelectedLaunchCohort = {
  methodologyVersion: string
  source: Omit<CohortCandidateSnapshot, 'candidates'>
  region: LaunchCohortRegion
  bracket: LaunchCohortBracket
  cap: typeof LAUNCH_COHORT_CAP
  minimumEvidencePlayers: typeof LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS
  eligiblePlayers: number
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  members: SelectedCohortMember[]
}

export type LaunchCohortCapacityEnvelope = {
  sourceDomain: 'brawlhalla-v1'
  quotaUnitsPerWindow: typeof LAUNCH_COHORT_SOURCE_QUOTA_UNITS
  quotaWindowSeconds: typeof LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS
  requestsPerPlayer: typeof LAUNCH_COHORT_REQUESTS_PER_PLAYER
  maxAttemptsPerRequest: typeof LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST
  plannedRequests: number
  maximumSourceAttempts: number
  minimumCapacitySeconds: number
  observationWindowSeconds: typeof LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS
}

export type SelectedFullLaunchCohort = {
  methodologyVersion: string
  sourceGenerationId: string
  sourceObservedAt: string
  cells: SelectedLaunchCohort[]
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  capacityEnvelope: LaunchCohortCapacityEnvelope
}

function selectionHash(methodologyVersion: string, brawlhallaId: number): string {
  return createHash('sha256').update(methodologyVersion).update('\0').update(String(brawlhallaId)).digest('hex')
}

function validateMethodologyVersion(methodologyVersion: string): void {
  if (!methodologyVersion || methodologyVersion.includes('\0')) {
    throw new Error('methodology version must be non-empty and cannot contain NUL')
  }
}

function candidateRatings(snapshot: CohortCandidateSnapshot): Map<number, number> {
  const ratings = new Map<number, number>()
  for (const candidate of snapshot.candidates) {
    if (!Number.isSafeInteger(candidate.brawlhallaId) || candidate.brawlhallaId <= 0) {
      throw new Error('candidate brawlhallaId must be a positive safe integer')
    }
    if (!Number.isSafeInteger(candidate.rating) || candidate.rating < 0) {
      throw new Error('candidate rating must be a non-negative safe integer')
    }
    const previous = ratings.get(candidate.brawlhallaId)
    if (previous !== undefined && previous !== candidate.rating) {
      throw new Error(`candidate ${candidate.brawlhallaId} has conflicting ratings`)
    }
    ratings.set(candidate.brawlhallaId, candidate.rating)
  }
  return ratings
}

export function selectLaunchCohortCell(
  snapshot: CohortCandidateSnapshot,
  bracket: LaunchCohortBracket,
  methodologyVersion = FULL_LAUNCH_COHORT_METHODOLOGY_VERSION,
): SelectedLaunchCohort {
  if (!launchCohortRegions.includes(snapshot.region) || snapshot.mode !== '1v1') {
    throw new Error('launch cohort source must be a supported regional 1v1 snapshot')
  }
  if (!launchCohortBrackets.includes(bracket)) throw new Error('launch cohort bracket is unsupported')
  validateMethodologyVersion(methodologyVersion)

  const eligible = new Map(
    [...candidateRatings(snapshot)].filter(([, rating]) => currentOneVsOneBracket(rating) === bracket),
  )

  const members = Array.from(eligible, ([brawlhallaId, sourceRating]) => ({
    brawlhallaId,
    sourceRating,
    selectionHash: selectionHash(methodologyVersion, brawlhallaId),
  }))
    .sort((left, right) => {
      if (left.selectionHash < right.selectionHash) return -1
      if (left.selectionHash > right.selectionHash) return 1
      return left.brawlhallaId - right.brawlhallaId
    })
    .slice(0, LAUNCH_COHORT_CAP)
    .map((member, index) => ({ ...member, ordinal: index + 1 }))

  return {
    methodologyVersion,
    source: {
      snapshotId: snapshot.snapshotId,
      generationId: snapshot.generationId,
      observedAt: snapshot.observedAt,
      region: snapshot.region,
      mode: snapshot.mode,
    },
    region: snapshot.region,
    bracket,
    cap: LAUNCH_COHORT_CAP,
    minimumEvidencePlayers: LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS,
    eligiblePlayers: eligible.size,
    selectedPlayers: members.length,
    state: members.length >= LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS ? 'ready' : 'insufficient-evidence',
    members,
  }
}

export function selectLaunchCohort(
  snapshot: CohortCandidateSnapshot,
  methodologyVersion = LAUNCH_COHORT_METHODOLOGY_VERSION,
): SelectedLaunchCohort {
  if (snapshot.region !== LAUNCH_COHORT_REGION || snapshot.mode !== '1v1') {
    throw new Error('launch cohort source must be the EU 1v1 snapshot')
  }
  return selectLaunchCohortCell(snapshot, LAUNCH_COHORT_BRACKET, methodologyVersion)
}

export function selectFullLaunchCohort(
  snapshots: readonly CohortCandidateSnapshot[],
  methodologyVersion = FULL_LAUNCH_COHORT_METHODOLOGY_VERSION,
): SelectedFullLaunchCohort {
  validateMethodologyVersion(methodologyVersion)
  if (snapshots.length !== launchCohortRegions.length) {
    throw new Error('full launch cohort requires exactly nine regional snapshots')
  }
  const byRegion = new Map(snapshots.map((snapshot) => [snapshot.region, snapshot]))
  if (byRegion.size !== launchCohortRegions.length || launchCohortRegions.some((region) => !byRegion.has(region))) {
    throw new Error('full launch cohort requires exactly one snapshot per launch region')
  }
  const [first] = snapshots
  if (!first || snapshots.some((snapshot) => snapshot.generationId !== first.generationId)) {
    throw new Error('full launch cohort must use one immutable Ranking generation')
  }
  if (snapshots.some((snapshot) => snapshot.observedAt !== first.observedAt)) {
    throw new Error('full launch cohort snapshots must share one observation timestamp')
  }

  const cells = launchCohortRegions.flatMap((region) => {
    const snapshot = byRegion.get(region)
    if (!snapshot) throw new Error(`missing launch cohort region ${region}`)
    return launchCohortBrackets.map((bracket) => selectLaunchCohortCell(snapshot, bracket, methodologyVersion))
  })
  const selectedPlayers = cells.reduce((total, cell) => total + cell.selectedPlayers, 0)
  const plannedRequests = selectedPlayers * LAUNCH_COHORT_REQUESTS_PER_PLAYER
  const maximumSourceAttempts = plannedRequests * LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST

  return {
    methodologyVersion,
    sourceGenerationId: first.generationId,
    sourceObservedAt: first.observedAt,
    cells,
    selectedPlayers,
    state: cells.every(({ state }) => state === 'ready') ? 'ready' : 'insufficient-evidence',
    capacityEnvelope: {
      sourceDomain: 'brawlhalla-v1',
      quotaUnitsPerWindow: LAUNCH_COHORT_SOURCE_QUOTA_UNITS,
      quotaWindowSeconds: LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS,
      requestsPerPlayer: LAUNCH_COHORT_REQUESTS_PER_PLAYER,
      maxAttemptsPerRequest: LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST,
      plannedRequests,
      maximumSourceAttempts,
      minimumCapacitySeconds:
        Math.ceil(maximumSourceAttempts / LAUNCH_COHORT_SOURCE_QUOTA_UNITS) * LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS,
      observationWindowSeconds: LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS,
    },
  }
}
