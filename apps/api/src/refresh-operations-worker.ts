import type {
  AdmissionConfig,
  FencedResult,
  OperationLease,
  RefreshOperationWorker,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission, SourceDomain } from '@brawltome/request-admission'

type ProofLease = Extract<OperationLease, { kind: 'proof' }>
type InteractiveLease = Extract<OperationLease, { kind: 'interactive-player-refresh' }>
type InteractiveSection = InteractiveLease['payload']['staleSections'][number]

type RunOneRefreshOperationOptions = {
  leaseMs: number
  retryDelayMs: number
  admission: AdmissionConfig
  renewEveryMs?: number
  sourceAdmission?: SourceAdmission
  executeEffect?: (lease: ProofLease) => Promise<FencedResult>
  executeSection?(
    lease: InteractiveLease,
    section: InteractiveSection,
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
  ): Promise<void>
}

class SourceAdmissionLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Source admission is rate limited')
  }
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
  operations: RefreshOperationWorker,
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

export async function reconcileInteractiveAdmissions(
  operations: RefreshOperationWorker,
  actorAdmission: ActorAdmission,
): Promise<number> {
  let activated = 0
  for (const operationId of await operations.listAwaitingInteractiveRefreshes()) {
    if (!(await actorAdmission.hasActorReservation(operationId))) continue
    if ((await operations.activateAdmittedInteractiveRefresh(operationId)) === 'transitioned') activated++
  }
  return activated
}

async function executeProof(
  operations: RefreshOperationWorker,
  lease: ProofLease,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
  try {
    const effect = options.executeEffect
      ? await options.executeEffect(lease)
      : await operations.commitProofEffect(lease)
    if (effect === 'lease-lost') return
    if (effect === 'effect-conflict') {
      await operations.fail(
        lease,
        { code: 'effect_conflict', message: 'Operation key belongs to a different effect', retryable: false },
        0,
      )
      return
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
}

async function executeInteractive(
  operations: RefreshOperationWorker,
  lease: InteractiveLease,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
  try {
    if (!options.sourceAdmission || !options.executeSection) {
      throw new Error('Interactive refresh dependencies are unavailable')
    }
    for (const section of lease.payload.staleSections) {
      if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return
      const checkpoint = await operations.beginInteractiveSection(lease, section)
      if (checkpoint === 'lease-lost') return
      if (checkpoint === 'already-applied') continue

      let sourceCall = 0
      const admitSourceCall = async (domain: SourceDomain) => {
        const sourceAdmission = await options.sourceAdmission?.admitSource({
          domain,
          reservationKey: `${lease.operationId}:${section}:${lease.attemptNumber}:${sourceCall++}`,
          units: 1,
        })
        if (!sourceAdmission) throw new Error('Source admission is unavailable')
        if (sourceAdmission.outcome === 'rate-limited') {
          throw new SourceAdmissionLimitedError(sourceAdmission.retryAfterSeconds)
        }
      }

      await options.executeSection(lease, section, admitSourceCall)
      if ((await operations.commitInteractiveSection(lease, section)) === 'lease-lost') return
    }
    await operations.complete(lease)
  } catch (error) {
    const retryDelayMs =
      error instanceof SourceAdmissionLimitedError ? error.retryAfterSeconds * 1_000 : options.retryDelayMs
    await operations.fail(
      lease,
      {
        code:
          error instanceof SourceAdmissionLimitedError ? 'source_rate_limited' : 'interactive_player_refresh_failed',
        message: error instanceof Error ? error.message : 'Unknown interactive refresh failure',
        retryable: true,
      },
      retryDelayMs,
    )
  }
}

export async function runOneRefreshOperation(
  operations: RefreshOperationWorker,
  workerId: string,
  options: RunOneRefreshOperationOptions,
): Promise<boolean> {
  const lease = await operations.claim(workerId, options.leaseMs, options.admission)
  if (!lease) return false

  const renewal = new AbortController()
  const renewEveryMs = options.renewEveryMs ?? Math.max(1, Math.floor(options.leaseMs / 3))
  const renewalLoop = renewLease(operations, lease, options.leaseMs, renewEveryMs, renewal.signal)
  try {
    if (lease.kind === 'proof') await executeProof(operations, lease, options)
    else await executeInteractive(operations, lease, options)
  } finally {
    renewal.abort()
    await renewalLoop
  }
  return true
}
