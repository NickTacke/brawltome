import type { FencedResult, OperationLease } from '@brawltome/refresh-operations'
import type { PostgresRefreshOperations } from '@brawltome/refresh-operations/composition'

type ProofWorkerOptions = {
  leaseMs: number
  retryDelayMs: number
  executeEffect?: (lease: OperationLease) => Promise<FencedResult>
}

export async function runOneProofOperation(
  operations: PostgresRefreshOperations,
  workerId: string,
  options: ProofWorkerOptions,
): Promise<boolean> {
  const lease = await operations.claim(workerId, options.leaseMs)
  if (!lease) return false

  try {
    const effect = options.executeEffect
      ? await options.executeEffect(lease)
      : await operations.commitProofEffect(lease)
    if (effect === 'lease-lost') return true
    if (effect === 'effect-conflict') {
      await operations.fail(
        lease,
        { code: 'effect_conflict', message: 'Operation key belongs to a different effect', retryable: false },
        0,
      )
      return true
    }
    await operations.complete(lease)
  } catch (error) {
    await operations.fail(
      lease,
      {
        code: 'proof_execution_failed',
        message: error instanceof Error ? error.message : 'Unknown proof execution failure',
        retryable: true,
      },
      options.retryDelayMs,
    )
  }
  return true
}
