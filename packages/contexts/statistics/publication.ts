import {
  LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST,
  LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS,
  LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS,
  LAUNCH_COHORT_REQUESTS_PER_PLAYER,
  LAUNCH_COHORT_SOURCE_QUOTA_UNITS,
  LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS,
  type LaunchCohortBracket,
  type LaunchCohortCapacityEnvelope,
  type LaunchCohortRegion,
  launchCohortBrackets,
  launchCohortRegions,
} from './cohort'

export type PublicationProduct = 'ranked' | 'lifetime'

export type CellCollectionProgress = {
  region: LaunchCohortRegion
  bracket: LaunchCohortBracket
  selectedPlayers: number
  operations: number
  sourceAttempts: number
  maximumPlayerAttempts: number
  successes: number
  firstAttemptAt: string | null
  lastCompletedAt: string | null
}

export type AuditedCellCollectionProgress = CellCollectionProgress & {
  coverageBasisPoints: number
}

export type PublicationValidationReason =
  | { code: 'cell-minimum-not-met'; region: LaunchCohortRegion; bracket: LaunchCohortBracket }
  | { code: 'collection-operations-incomplete' }
  | { code: 'overall-coverage-below-95-percent' }
  | { code: 'cell-coverage-below-90-percent'; region: LaunchCohortRegion; bracket: LaunchCohortBracket }
  | { code: 'observation-window-violated' }
  | { code: 'capacity-envelope-exceeded' }
  | { code: 'career-weapon-duplicate-player'; brawlhallaId: number }
  | { code: 'career-weapon-unresolved-legend'; legendId: number }

export type PublicationDecisionEvidence = {
  generationId: string
  outcome: 'accepted' | 'rejected'
  reasons: PublicationValidationReason[]
  progress: {
    product: PublicationProduct
    selectedPlayers: number
    operations: number
    sourceAttempts: number
    successes: number
    overallCoverageBasisPoints: number
    cells: AuditedCellCollectionProgress[]
  }
  observationWindow: { startsAt: string; endsAt: string }
  capacityEnvelope: LaunchCohortCapacityEnvelope
}

function boundedCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
}

function coverageBasisPoints(successes: number, selectedPlayers: number): number {
  return selectedPlayers === 0 ? 0 : Math.floor((successes * 10_000) / selectedPlayers)
}

function timestamp(value: string, name: string): number {
  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid timestamp`)
  return parsed
}

function validateCellSet(cells: readonly CellCollectionProgress[]): void {
  if (cells.length !== launchCohortRegions.length * launchCohortBrackets.length) {
    throw new Error('publication validation requires exactly 18 launch cells')
  }
  const keys = new Set(cells.map(({ region, bracket }) => `${region}:${bracket}`))
  const expected = launchCohortRegions.flatMap((region) =>
    launchCohortBrackets.map((bracket) => `${region}:${bracket}`),
  )
  if (keys.size !== expected.length || expected.some((key) => !keys.has(key))) {
    throw new Error('publication validation requires exactly one progress row per launch cell')
  }
}

export function validatePublicationDecision(input: {
  generationId: string
  product: PublicationProduct
  cells: readonly CellCollectionProgress[]
  observationWindow: { startsAt: string; endsAt: string }
  capacityEnvelope: LaunchCohortCapacityEnvelope
}): PublicationDecisionEvidence {
  validateCellSet(input.cells)
  const startsAt = timestamp(input.observationWindow.startsAt, 'observation window start')
  const endsAt = timestamp(input.observationWindow.endsAt, 'observation window end')
  if (endsAt <= startsAt) throw new Error('observation window end must follow its start')

  const cells = input.cells.map((cell) => {
    boundedCount(cell.selectedPlayers, 'selectedPlayers')
    boundedCount(cell.operations, 'operations')
    boundedCount(cell.sourceAttempts, 'sourceAttempts')
    boundedCount(cell.maximumPlayerAttempts, 'maximumPlayerAttempts')
    boundedCount(cell.successes, 'successes')
    if (cell.operations > cell.selectedPlayers || cell.successes > cell.operations) {
      throw new Error('cell successes must not exceed operations or selected players')
    }
    return { ...cell, coverageBasisPoints: coverageBasisPoints(cell.successes, cell.selectedPlayers) }
  })
  const selectedPlayers = cells.reduce((total, cell) => total + cell.selectedPlayers, 0)
  const operations = cells.reduce((total, cell) => total + cell.operations, 0)
  const sourceAttempts = cells.reduce((total, cell) => total + cell.sourceAttempts, 0)
  const successes = cells.reduce((total, cell) => total + cell.successes, 0)
  const reasons: PublicationValidationReason[] = []

  const minimumFailure = cells.find(({ selectedPlayers }) => selectedPlayers < LAUNCH_COHORT_MINIMUM_EVIDENCE_PLAYERS)
  if (minimumFailure) {
    reasons.push({
      code: 'cell-minimum-not-met',
      region: minimumFailure.region,
      bracket: minimumFailure.bracket,
    })
  }
  if (cells.some((cell) => cell.operations !== cell.selectedPlayers)) {
    reasons.push({ code: 'collection-operations-incomplete' })
  }
  if (successes * 100 < selectedPlayers * 95) {
    reasons.push({ code: 'overall-coverage-below-95-percent' })
  }
  const coverageFailure = cells.find((cell) => cell.successes * 100 < cell.selectedPlayers * 90)
  if (coverageFailure) {
    reasons.push({
      code: 'cell-coverage-below-90-percent',
      region: coverageFailure.region,
      bracket: coverageFailure.bracket,
    })
  }

  const windowViolated = cells.some((cell) => {
    if (cell.operations === 0) return true
    if (!cell.firstAttemptAt || !cell.lastCompletedAt) return true
    return (
      timestamp(cell.firstAttemptAt, 'first attempt') < startsAt ||
      timestamp(cell.lastCompletedAt, 'last completion') > endsAt
    )
  })
  if (windowViolated) reasons.push({ code: 'observation-window-violated' })

  const envelope = input.capacityEnvelope
  const expectedWindowSeconds = Math.floor((endsAt - startsAt) / 1_000)
  const expectedMinimumCapacitySeconds =
    Math.ceil(envelope.maximumSourceAttempts / LAUNCH_COHORT_SOURCE_QUOTA_UNITS) *
    LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS
  const capacityViolated =
    envelope.sourceDomain !== 'brawlhalla-v1' ||
    envelope.quotaUnitsPerWindow !== LAUNCH_COHORT_SOURCE_QUOTA_UNITS ||
    envelope.quotaWindowSeconds !== LAUNCH_COHORT_SOURCE_QUOTA_WINDOW_SECONDS ||
    envelope.requestsPerPlayer !== LAUNCH_COHORT_REQUESTS_PER_PLAYER ||
    envelope.maxAttemptsPerRequest !== LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST ||
    envelope.plannedRequests !== selectedPlayers * envelope.requestsPerPlayer ||
    envelope.maximumSourceAttempts !== envelope.plannedRequests * envelope.maxAttemptsPerRequest ||
    envelope.minimumCapacitySeconds !== expectedMinimumCapacitySeconds ||
    envelope.minimumCapacitySeconds > expectedWindowSeconds ||
    envelope.observationWindowSeconds !== LAUNCH_COHORT_OBSERVATION_WINDOW_SECONDS ||
    sourceAttempts > envelope.maximumSourceAttempts / LAUNCH_COHORT_REQUESTS_PER_PLAYER ||
    cells.some(({ maximumPlayerAttempts }) => maximumPlayerAttempts > LAUNCH_COHORT_MAX_ATTEMPTS_PER_REQUEST)
  if (capacityViolated) reasons.push({ code: 'capacity-envelope-exceeded' })

  return {
    generationId: input.generationId,
    outcome: reasons.length === 0 ? 'accepted' : 'rejected',
    reasons,
    progress: {
      product: input.product,
      selectedPlayers,
      operations,
      sourceAttempts,
      successes,
      overallCoverageBasisPoints: coverageBasisPoints(successes, selectedPlayers),
      cells,
    },
    observationWindow: input.observationWindow,
    capacityEnvelope: input.capacityEnvelope,
  }
}
