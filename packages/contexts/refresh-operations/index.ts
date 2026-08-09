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

export type AcceptProofOperation = {
  dedupeKey: string
  operationKey: string
  workClass: WorkClass
  payload: { value: string }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptOperationResult = {
  outcome: 'accepted' | 'already-active'
  operationId: string
}

export type CreateProofSchedule = {
  scheduleKey: string
  operationKeyPrefix: string
  workClass: WorkClass
  intervalMs: number
  firstDueAt: string
  payload: { value: string }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type CreateScheduleResult = {
  outcome: 'created' | 'already-exists'
  scheduleId: string
}

export type MaterializeSchedulesResult = {
  occurrencesCreated: number
  scheduleIds: string[]
}

export type OperationLease = {
  operationId: string
  operationKey: string
  workClass: WorkClass
  payload: { value: string }
  provenance: OperationProvenance
  leaseOwner: string
  leaseToken: number
  attemptNumber: number
  maxAttempts: number
}

export type OperationFailure = {
  code: string
  message: string
  retryable: boolean
}

export type FencedResult = 'applied' | 'already-applied' | 'effect-conflict' | 'lease-lost'
export type TransitionResult = 'transitioned' | 'lease-lost'
