import type { AttemptOutcome, Lease, LeaseOperations, OperationFailure } from '@brawltome/refresh-operations'

export async function completeAttempt(queue: LeaseOperations, lease: Lease<unknown>): Promise<AttemptOutcome> {
  return (await queue.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export async function deadLetterAttempt(
  queue: LeaseOperations,
  lease: Lease<unknown>,
  code: string,
  message: string,
): Promise<AttemptOutcome> {
  const transition = await queue.fail(lease, { code, message, retryable: false }, 0)

  return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
}

export async function deferAttempt(
  queue: LeaseOperations,
  lease: Lease<unknown>,
  failure: OperationFailure,
  retryDelayMs: number,
): Promise<AttemptOutcome> {
  const transition = await queue.defer(lease, failure, retryDelayMs)

  return transition === 'lease-lost' ? 'lease_lost' : 'retry'
}
