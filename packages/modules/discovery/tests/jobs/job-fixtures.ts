import type { Lease, OperationFailure, QueueWorker } from '@brawltome/queue'

export type DiscoveryLeaseOptions = {
  kind: string
  payload: unknown
  maxAttempts?: number
}

export function discoveryLease({ kind, payload, maxAttempts = 3 }: DiscoveryLeaseOptions): Lease<unknown> {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: `${kind}:test`,
    kind,
    workClass: 'projection',
    payload,
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts,
    scheduleWindowAt: null,
  }
}

export function createQueueSpy(leases: Lease<unknown>[]) {
  const failures: OperationFailure[] = []
  const deferrals: OperationFailure[] = []
  let completions = 0
  let appliedRetries = 0

  const queue = {
    claim: async () => leases.shift() ?? null,
    renew: async () => 'renewed' as const,
    complete: async () => {
      completions++

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      failures.push(failure)

      return 'transitioned' as const
    },
    defer: async (_lease: Lease<unknown>, failure: OperationFailure) => {
      deferrals.push(failure)

      return 'transitioned' as const
    },
    retryAppliedEffect: async () => {
      appliedRetries++

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return {
    queue,
    failures,
    deferrals,
    completions: () => completions,
    appliedRetries: () => appliedRetries,
  }
}
