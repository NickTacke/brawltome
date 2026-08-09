export type OperationProvenance = {
  source: string
  requestedBy?: string
}

export type AcceptProofOperation = {
  dedupeKey: string
  operationKey: string
  payload: { value: string }
  provenance: OperationProvenance
  maxAttempts?: number
}

export type AcceptOperationResult = {
  outcome: 'accepted' | 'already-active'
  operationId: string
}

export type OperationLease = {
  operationId: string
  operationKey: string
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
