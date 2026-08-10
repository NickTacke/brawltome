import { createHash } from 'node:crypto'

export const LAUNCH_COHORT_REGION = 'EU' as const
export const LAUNCH_COHORT_BRACKET = 'Diamond+' as const
export const LAUNCH_COHORT_CAP = 750
export const LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS = 125
export const LAUNCH_COHORT_METHODOLOGY_VERSION = 'eu-diamond-tracer-v1'
const METHODOLOGY_V1_DIAMOND_MIN_RATING = 2000

export type CohortCandidateSnapshot = {
  snapshotId: string
  generationId: string
  observedAt: string
  region: typeof LAUNCH_COHORT_REGION
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
  cap: typeof LAUNCH_COHORT_CAP
  minimumEvidencePlayers: typeof LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS
  eligiblePlayers: number
  selectedPlayers: number
  state: 'ready' | 'insufficient-evidence'
  members: SelectedCohortMember[]
}

function selectionHash(methodologyVersion: string, brawlhallaId: number): string {
  return createHash('sha256').update(methodologyVersion).update('\0').update(String(brawlhallaId)).digest('hex')
}

export function selectLaunchCohort(
  snapshot: CohortCandidateSnapshot,
  methodologyVersion = LAUNCH_COHORT_METHODOLOGY_VERSION,
): SelectedLaunchCohort {
  if (snapshot.region !== LAUNCH_COHORT_REGION || snapshot.mode !== '1v1') {
    throw new Error('launch cohort source must be the EU 1v1 snapshot')
  }
  if (!methodologyVersion || methodologyVersion.includes('\0')) {
    throw new Error('methodology version must be non-empty and cannot contain NUL')
  }

  const eligible = new Map<number, number>()
  for (const candidate of snapshot.candidates) {
    if (!Number.isSafeInteger(candidate.brawlhallaId) || candidate.brawlhallaId <= 0) {
      throw new Error('candidate brawlhallaId must be a positive safe integer')
    }
    if (!Number.isSafeInteger(candidate.rating) || candidate.rating < 0) {
      throw new Error('candidate rating must be a non-negative safe integer')
    }
    if (candidate.rating < METHODOLOGY_V1_DIAMOND_MIN_RATING) continue
    const previous = eligible.get(candidate.brawlhallaId)
    if (previous !== undefined && previous !== candidate.rating) {
      throw new Error(`candidate ${candidate.brawlhallaId} has conflicting ratings`)
    }
    eligible.set(candidate.brawlhallaId, candidate.rating)
  }

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
    cap: LAUNCH_COHORT_CAP,
    minimumEvidencePlayers: LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS,
    eligiblePlayers: eligible.size,
    selectedPlayers: members.length,
    state: members.length >= LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS ? 'ready' : 'insufficient-evidence',
    members,
  }
}
