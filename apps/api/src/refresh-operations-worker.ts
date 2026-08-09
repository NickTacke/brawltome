import {
  LeaderboardLeaseLostError,
  type LeaderboardPageSource,
  type RankingPublicationStore,
  collectAndPublish1v1Generation,
} from '@brawltome/ranking/composition'
import type {
  AdmissionConfig,
  FencedResult,
  OperationLease,
  RefreshOperationWorker,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission, SourceDomain } from '@brawltome/request-admission'

type ProofLease = Extract<OperationLease, { kind: 'proof' }>
type InteractiveLease = Extract<OperationLease, { kind: 'interactive-player-refresh' }>
type LeaderboardLease = Extract<OperationLease, { kind: 'leaderboard-1v1' }>
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
  ranking?: RankingPublicationStore
  leaderboardSource?: LeaderboardPageSource
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

function failureDetails(error: unknown, fallbackCode: string) {
  if (error && typeof error === 'object') {
    return {
      code: 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode,
      message: 'message' in error && typeof error.message === 'string' ? error.message : 'Unknown operation failure',
      retryable: !('retryable' in error) || error.retryable !== false,
    }
  }
  return { code: fallbackCode, message: 'Unknown operation failure', retryable: true }
}

async function executeProof(
  operations: RefreshOperationWorker,
  lease: ProofLease,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
  const effect = options.executeEffect ? await options.executeEffect(lease) : await operations.commitProofEffect(lease)
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
}

async function executeInteractive(
  operations: RefreshOperationWorker,
  lease: InteractiveLease,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
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
}

async function executeLeaderboard(
  operations: RefreshOperationWorker,
  lease: LeaderboardLease,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
  if (!options.ranking || !options.leaderboardSource) {
    await operations.fail(
      lease,
      { code: 'leaderboard_executor_unavailable', message: 'Leaderboard executor is not configured', retryable: false },
      0,
    )
    return
  }
  await collectAndPublish1v1Generation({
    authorization: {
      operationId: lease.operationId,
      operationKey: lease.operationKey,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      scheduleWindowAt: lease.scheduleWindowAt,
    },
    source: options.leaderboardSource,
    publication: options.ranking,
    pageDepth: lease.payload.pageDepth,
    intervalMs: lease.payload.intervalMs,
  })
  await operations.complete(lease)
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
    else if (lease.kind === 'interactive-player-refresh') await executeInteractive(operations, lease, options)
    else await executeLeaderboard(operations, lease, options)
  } catch (error) {
    if (error instanceof LeaderboardLeaseLostError) return true
    const retryDelayMs =
      error instanceof SourceAdmissionLimitedError ? error.retryAfterSeconds * 1_000 : options.retryDelayMs
    const fallbackCode =
      error instanceof SourceAdmissionLimitedError
        ? 'source_rate_limited'
        : lease.kind === 'proof'
          ? 'proof_execution_failed'
          : lease.kind === 'interactive-player-refresh'
            ? 'interactive_player_refresh_failed'
            : 'leaderboard_collection_failed'
    await operations.fail(lease, failureDetails(error, fallbackCode), retryDelayMs)
  } finally {
    renewal.abort()
    await renewalLoop
  }
  return true
}

export const runOneDurableOperation = runOneRefreshOperation
