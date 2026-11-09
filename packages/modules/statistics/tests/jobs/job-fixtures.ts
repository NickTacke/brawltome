import type { Lease, OperationFailure, RenewResult, TransitionResult } from '@brawltome/queue'

export function statisticsLease(kind: string, payload: unknown): Lease<unknown> {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: `${kind}:test`,
    kind,
    workClass: 'global-statistics',
    payload,
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

export type RecordedFailure = { failure: OperationFailure; retryDelayMs: number }

// the renewals answer in order and then keep renewing; the transitions all answer with one result
export function createQueueSpy(
  lease: Lease<unknown>,
  options: { renewals?: RenewResult[]; transition?: TransitionResult } = {},
) {
  const renewals = [...(options.renewals ?? [])]
  const transition = options.transition ?? 'transitioned'
  const failures: RecordedFailure[] = []
  const deferrals: RecordedFailure[] = []
  let completions = 0

  const queue = {
    claim: async () => lease,
    renew: async () => renewals.shift() ?? ('renewed' as const),
    defer: async (_lease: unknown, failure: OperationFailure, retryDelayMs: number) => {
      deferrals.push({ failure, retryDelayMs })

      return transition
    },
    complete: async () => {
      completions++

      return transition
    },
    fail: async (_lease: unknown, failure: OperationFailure, retryDelayMs: number) => {
      failures.push({ failure, retryDelayMs })

      return transition
    },
  }

  return { queue, failures, deferrals, completions: () => completions }
}
