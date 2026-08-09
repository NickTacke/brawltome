import type { AdmissionConfig, FencedResult, OperationLease } from '@brawltome/refresh-operations'
import type { PostgresRefreshOperations } from '@brawltome/refresh-operations/composition'

type ProofWorkerOptions = {
  leaseMs: number
  retryDelayMs: number
  admission: AdmissionConfig
  renewEveryMs?: number
  executeEffect?: (lease: OperationLease) => Promise<FencedResult>
}

function waitForRenewal(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, intervalMs)
    signal.addEventListener('abort', done, { once: true })
  })
}

async function renewLease(
  operations: PostgresRefreshOperations,
  lease: OperationLease,
  leaseMs: number,
  intervalMs: number,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await waitForRenewal(intervalMs, signal)
    if (signal.aborted) return
    try {
      if ((await operations.renew(lease, leaseMs)) === 'lease-lost') return
    } catch {
      return
    }
  }
}

export async function runOneProofOperation(
  operations: PostgresRefreshOperations,
  workerId: string,
  options: ProofWorkerOptions,
): Promise<boolean> {
  const lease = await operations.claim(workerId, options.leaseMs, options.admission)
  if (!lease) return false

  const renewal = new AbortController()
  const renewEveryMs = options.renewEveryMs ?? Math.max(1, Math.floor(options.leaseMs / 3))
  const renewalLoop = renewLease(operations, lease, options.leaseMs, renewEveryMs, renewal.signal)
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
  } finally {
    renewal.abort()
    await renewalLoop
  }
  return true
}
