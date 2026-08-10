export const workClasses = [
  'interactive',
  'primary-monitoring',
  'leaderboard',
  'global-statistics',
  'projection',
  'maintenance',
] as const

export type WorkClass = (typeof workClasses)[number]

export const backgroundWorkClasses = [
  'primary-monitoring',
  'leaderboard',
  'global-statistics',
  'projection',
  'maintenance',
] as const satisfies readonly WorkClass[]

export type BackgroundWorkClass = (typeof backgroundWorkClasses)[number]

export const minLeaderboardIntervalMs = 60_000
export const maxLeaderboardIntervalMs = 24 * 60 * 60 * 1000
export const maxLeaderboardPageDepth = 20

export type OperationProvenance = {
  source: string
  requestedBy?: string
}

export type AdmissionConfig = {
  totalConcurrency: number
  interactiveReservation: number
  classConcurrency: Record<WorkClass, number>
  backgroundWeights: Record<BackgroundWorkClass, number>
}

export function validateAdmissionConfig(config: AdmissionConfig): AdmissionConfig {
  const integer = (value: number, name: string, minimum: number, maximum: number) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
    }
  }

  integer(config.totalConcurrency, 'totalConcurrency', 2, 10_000)
  integer(config.interactiveReservation, 'interactiveReservation', 1, config.totalConcurrency - 1)
  for (const workClass of workClasses) {
    integer(config.classConcurrency[workClass], `classConcurrency.${workClass}`, 1, config.totalConcurrency)
  }
  if (config.classConcurrency.interactive < config.interactiveReservation) {
    throw new Error('classConcurrency.interactive must cover interactiveReservation')
  }
  for (const workClass of backgroundWorkClasses) {
    integer(config.backgroundWeights[workClass], `backgroundWeights.${workClass}`, 1, 10_000)
  }
  return config
}

export const leaderboardOperationKinds = [
  'leaderboard-1v1',
  'leaderboard-2v2',
  'leaderboard-solo-2v2',
  'leaderboard-3v3',
] as const
export type LeaderboardOperationKind = (typeof leaderboardOperationKinds)[number]

export type LeaderboardOperationPayload = {
  pageDepth: number
  intervalMs: number
}

export function validateLeaderboardOperationPayload(payload: LeaderboardOperationPayload): LeaderboardOperationPayload {
  if (
    !Number.isSafeInteger(payload.pageDepth) ||
    payload.pageDepth < 1 ||
    payload.pageDepth > maxLeaderboardPageDepth
  ) {
    throw new Error(`leaderboard pageDepth must be an integer between 1 and ${maxLeaderboardPageDepth}`)
  }
  if (
    !Number.isSafeInteger(payload.intervalMs) ||
    payload.intervalMs < minLeaderboardIntervalMs ||
    payload.intervalMs > maxLeaderboardIntervalMs
  ) {
    throw new Error(
      `leaderboard intervalMs must be an integer between ${minLeaderboardIntervalMs} and ${maxLeaderboardIntervalMs}`,
    )
  }
  return payload
}

export type AcceptProofOperation = {
  kind?: 'proof'
  dedupeKey: string
  operationKey: string
  workClass: WorkClass
  payload: { value: string }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptRankedPlayerPulseOperation = {
  kind: 'ranked-player-pulse'
  dedupeKey: string
  operationKey: string
  workClass: 'primary-monitoring'
  payload: { brawlhallaId: number }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptLeaderboardOperation = {
  kind: LeaderboardOperationKind
  dedupeKey: string
  operationKey: string
  workClass: 'leaderboard'
  payload: LeaderboardOperationPayload
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptPlayerDiscoveryProjection = {
  kind: 'player-discovery-projection'
  dedupeKey: string
  operationKey: string
  workClass: 'projection'
  payload: { batchSize: number }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptOperation =
  | AcceptProofOperation
  | AcceptRankedPlayerPulseOperation
  | AcceptLeaderboardOperation
  | AcceptPlayerDiscoveryProjection

export type AcceptOperationResult = {
  outcome: 'accepted' | 'already-active'
  operationId: string
}

export type CreateProofSchedule = {
  kind?: 'proof'
  scheduleKey: string
  operationKeyPrefix: string
  workClass: WorkClass
  intervalMs: number
  firstDueAt: string
  payload: { value: string }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type CreateLeaderboardSchedule = {
  kind: LeaderboardOperationKind
  scheduleKey: string
  operationKeyPrefix: string
  workClass: 'leaderboard'
  intervalMs: number
  firstDueAt: string
  payload: LeaderboardOperationPayload
  provenance: OperationProvenance
  maxAttempts?: number
}

export type CreateSchedule = CreateProofSchedule | CreateLeaderboardSchedule

export type CreateScheduleResult = {
  outcome: 'created' | 'already-exists' | 'reconciled'
  scheduleId: string
}

export type MaterializeSchedulesResult = {
  occurrencesCreated: number
  scheduleIds: string[]
}

export type InteractivePlayerRefreshReservation = {
  dedupeKey: string
  operationKey: string
  brawlhallaId: number
  staleSections: ('ranked' | 'stats')[]
  provenance: OperationProvenance
  reservationTtlSeconds: number
}

export type InteractiveClanRefreshReservation = {
  dedupeKey: string
  operationKey: string
  clanId: number
  staleSections: ('profile' | 'roster')[]
  provenance: OperationProvenance
  reservationTtlSeconds: number
}

export type ReserveInteractiveRefreshResult =
  | { outcome: 'reserved'; operationId: string; reservationToken: string }
  | { outcome: 'already-active'; operationId: string }

export type ActiveInteractiveRefresh = {
  operationId: string
  awaitingAdmission: boolean
  reservationExpired: boolean
}

export interface InteractiveRefreshOperations {
  findActiveInteractivePlayerRefresh(dedupeKey: string): Promise<ActiveInteractiveRefresh | null>
  findActiveInteractiveClanRefresh(dedupeKey: string): Promise<ActiveInteractiveRefresh | null>
  reserveInteractivePlayerRefresh(input: InteractivePlayerRefreshReservation): Promise<ReserveInteractiveRefreshResult>
  reserveInteractiveClanRefresh(input: InteractiveClanRefreshReservation): Promise<ReserveInteractiveRefreshResult>
  activateInteractiveRefresh(operationId: string, reservationToken: string): Promise<TransitionResult>
  activateAdmittedInteractiveRefresh(operationId: string): Promise<TransitionResult>
  rejectInteractiveRefresh(operationId: string, reservationToken: string, reason: string): Promise<TransitionResult>
  rejectExpiredInteractiveRefresh(operationId: string): Promise<TransitionResult>
}

type LeaseFields = {
  operationId: string
  effectOperationId: string
  effectCreatedAt: string
  operationKey: string
  provenance: OperationProvenance
  leaseOwner: string
  leaseToken: number
  attemptNumber: number
  maxAttempts: number
  scheduleWindowAt: string | null
}

export type OperationLease =
  | (LeaseFields & { kind: 'proof'; workClass: WorkClass; payload: { value: string } })
  | (LeaseFields & {
      kind: 'interactive-player-refresh'
      workClass: 'interactive'
      payload: { brawlhallaId: number; staleSections: ('ranked' | 'stats')[] }
    })
  | (LeaseFields & {
      kind: 'player-discovery-projection'
      workClass: 'projection'
      payload: { batchSize: number }
    })
  | (LeaseFields & {
      kind: 'clan-refresh'
      workClass: 'interactive'
      payload: { clanId: number; staleSections: ('profile' | 'roster')[] }
    })
  | (LeaseFields & {
      kind: 'ranked-player-pulse'
      workClass: 'primary-monitoring'
      payload: { brawlhallaId: number }
    })
  | (LeaseFields & { kind: LeaderboardOperationKind; workClass: 'leaderboard'; payload: LeaderboardOperationPayload })

export type OperationFailure = {
  code: string
  message: string
  retryable: boolean
}

export type FencedResult = 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'
export type SectionCheckpointResult = 'execute' | 'already-applied' | 'lease-lost'
export type TransitionResult = 'transitioned' | 'lease-lost'
export type RenewResult = 'renewed' | 'lease-lost'
export type LeaseAuthorityResult = { outcome: 'renewed'; leaseExpiresAt: Date } | { outcome: 'lease-lost' }

export type DeadLetterDisposition = 'replayed' | 'discarded'

export type DeadLetterListItem = {
  operationId: string
  kind: OperationLease['kind']
  operationKey: string
  workClass: WorkClass
  provenance: OperationProvenance
  attemptCount: number
  maxAttempts: number
  lastError: OperationFailure | null
  deadLetteredAt: string
  disposition: DeadLetterDisposition | null
}

export type ListDeadLettersInput = {
  limit?: number
  cursor?: string
}

export type DeadLetterPage = {
  items: DeadLetterListItem[]
  nextCursor: string | null
}

export type DeadLetterAuditAction = {
  actionId: string
  targetOperationId: string
  disposition: DeadLetterDisposition
  actorId: string
  reason: string
  occurredAt: string
  replayOperationId: string | null
}

export type DeadLetterInspection = {
  operation: DeadLetterListItem & {
    dedupeKey: string
    payload: OperationLease['payload']
    payloadVersion: number
    replayedFromOperationId: string | null
  }
  attempts: {
    attemptNumber: number
    leaseToken: number
    leaseOwner: string
    startedAt: string
    finishedAt: string | null
    outcome: 'succeeded' | 'retry' | 'dead_letter' | 'lease_expired' | null
    error: OperationFailure | null
  }[]
  proofEffects: {
    operationKey: string
    effectValue: { value: string }
    createdAt: string
  }[]
  interactiveEffects: {
    section: 'ranked' | 'stats' | 'profile' | 'roster'
    leaseToken: number
    completedAt: string
  }[]
  leaderboardEffects: {
    operationKey: string
    leaseToken: number
    createdAt: string
  }[]
  schedule: {
    scheduleId: string
    scheduleKey: string
    firstWindowNumber: number
    lastWindowNumber: number
    windowDueAt: string
    materializedAt: string
    latenessMs: number
    missedWindowCount: number
    catchUp: boolean
  } | null
  auditActions: DeadLetterAuditAction[]
}

export type DeadLetterDispositionInput = {
  operationId: string
  actorId: string
  reason: string
}

export type DeadLetterDispositionResult =
  | { outcome: 'replayed'; disposition: 'replayed'; actionId: string; replayOperationId: string }
  | { outcome: 'discarded'; disposition: 'discarded'; actionId: string; replayOperationId: null }
  | {
      outcome: 'already-disposed'
      disposition: 'replayed'
      actionId: string
      replayOperationId: string
    }
  | {
      outcome: 'already-disposed'
      disposition: 'discarded'
      actionId: string
      replayOperationId: null
    }
  | { outcome: 'not-found'; disposition: null; actionId: null; replayOperationId: null }

export interface DeadLetterOperations {
  listDeadLetters(input?: ListDeadLettersInput): Promise<DeadLetterPage>
  inspectDeadLetter(operationId: string): Promise<DeadLetterInspection | null>
  replayDeadLetter(input: DeadLetterDispositionInput): Promise<DeadLetterDispositionResult>
  discardDeadLetter(input: DeadLetterDispositionInput): Promise<DeadLetterDispositionResult>
}

export interface RefreshOperationWorker {
  claim(
    workerId: string,
    leaseMs: number,
    admission: AdmissionConfig,
    kind?: OperationLease['kind'],
  ): Promise<OperationLease | null>
  listAwaitingInteractiveRefreshes(): Promise<string[]>
  activateAdmittedInteractiveRefresh(operationId: string): Promise<TransitionResult>
  renew(lease: OperationLease, leaseMs: number): Promise<RenewResult>
  renewWithAuthority(lease: OperationLease, leaseMs: number): Promise<LeaseAuthorityResult>
  beginInteractiveSection(
    lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
    section: 'ranked' | 'stats' | 'profile' | 'roster',
  ): Promise<SectionCheckpointResult>
  commitInteractiveSection(
    lease: Extract<OperationLease, { kind: 'interactive-player-refresh' | 'clan-refresh' }>,
    section: 'ranked' | 'stats' | 'profile' | 'roster',
  ): Promise<TransitionResult>
  commitProofEffect(lease: Extract<OperationLease, { kind: 'proof' }>): Promise<FencedResult>
  retryAppliedPlayerProjection(
    lease: Extract<OperationLease, { kind: 'player-discovery-projection' }>,
    retryDelayMs: number,
  ): Promise<TransitionResult>
  complete(lease: OperationLease): Promise<TransitionResult>
  fail(lease: OperationLease, failure: OperationFailure, retryDelayMs: number): Promise<TransitionResult>
}
