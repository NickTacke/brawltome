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
type PlayerLease = Extract<OperationLease, { kind: 'interactive-player-refresh' }>
type ClanLease = Extract<OperationLease, { kind: 'clan-refresh' }>
type LeaderboardLease = Extract<OperationLease, { kind: 'leaderboard-1v1' }>
type InteractiveLease = PlayerLease | ClanLease
type InteractiveSection = 'ranked' | 'stats' | 'profile' | 'roster'

type RunOneRefreshOperationOptions = {
  leaseMs: number
  retryDelayMs: number
  admission: AdmissionConfig
  renewEveryMs?: number
  sourceAdmission?: SourceAdmission
  executeEffect?: (lease: ProofLease) => Promise<FencedResult>
  executeSection?(
    lease: PlayerLease,
    section: 'ranked' | 'stats',
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
  ): Promise<void>
  executeClanSection?(
    lease: ClanLease,
    section: 'profile' | 'roster',
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
    leaseExpiresAt: Date,
  ): Promise<void>
  syncClanLeaseAuthority?(lease: ClanLease, section: 'profile' | 'roster', leaseExpiresAt: Date): Promise<void>
  revokeClanLeaseAuthority?(lease: ClanLease, section: 'profile' | 'roster'): Promise<void>
  ranking?: RankingPublicationStore
  leaderboardSource?: LeaderboardPageSource
}

type ActiveClanAuthority = { lease: ClanLease; section: 'profile' | 'roster' } | null

class SourceAdmissionLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Source admission is rate limited')
  }
}

function sourceRetryAfterMs(error: unknown): number | null {
  if (error instanceof SourceAdmissionLimitedError) return error.retryAfterSeconds * 1_000
  if (
    typeof error === 'object' &&
    error !== null &&
    'retryAfterMs' in error &&
    typeof error.retryAfterMs === 'number' &&
    Number.isFinite(error.retryAfterMs)
  ) {
    return Math.max(0, error.retryAfterMs)
  }
  return null
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
  clanAuthority: { active: ActiveClanAuthority },
  authorityLost: AbortController,
  options: RunOneRefreshOperationOptions,
): Promise<void> {
  const revokeActiveAuthority = async () => {
    authorityLost.abort()
    const active = clanAuthority.active
    if (active && options.revokeClanLeaseAuthority) {
      await options.revokeClanLeaseAuthority(active.lease, active.section).catch(() => undefined)
    }
  }

  while (!signal.aborted) {
    await waitForRenewal(intervalMs, signal)
    if (signal.aborted) return
    try {
      if (lease.kind === 'clan-refresh') {
        const authority = await operations.renewWithAuthority(lease, leaseMs)
        if (authority.outcome === 'lease-lost') {
          await revokeActiveAuthority()
          return
        }
        const active = clanAuthority.active
        if (active && options.syncClanLeaseAuthority) {
          await options.syncClanLeaseAuthority(active.lease, active.section, authority.leaseExpiresAt)
        }
      } else if ((await operations.renew(lease, leaseMs)) === 'lease-lost') {
        authorityLost.abort()
        return
      }
    } catch {
      await revokeActiveAuthority()
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

function createSourceAdmission(
  options: RunOneRefreshOperationOptions,
  lease: InteractiveLease,
  section: InteractiveSection,
): (domain: SourceDomain) => Promise<void> {
  let sourceCall = 0
  return async (domain) => {
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
}

async function executeInteractive(
  operations: RefreshOperationWorker,
  lease: InteractiveLease,
  options: RunOneRefreshOperationOptions,
  clanAuthority: { active: ActiveClanAuthority },
  authorityLost: AbortController,
): Promise<void> {
  if (!options.sourceAdmission) throw new Error('Interactive refresh dependencies are unavailable')
  const failures: unknown[] = []

  for (const section of lease.payload.staleSections as InteractiveSection[]) {
    if (authorityLost.signal.aborted) return
    let leaseExpiresAt: Date | undefined
    if (lease.kind === 'clan-refresh') {
      const authority = await operations.renewWithAuthority(lease, options.leaseMs)
      if (authority.outcome === 'lease-lost') {
        authorityLost.abort()
        return
      }
      leaseExpiresAt = authority.leaseExpiresAt
    } else if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') {
      authorityLost.abort()
      return
    }

    const checkpoint = await operations.beginInteractiveSection(lease, section)
    if (checkpoint === 'lease-lost' || authorityLost.signal.aborted) return
    if (checkpoint === 'already-applied') continue

    const admitSourceCall = createSourceAdmission(options, lease, section)
    try {
      if (lease.kind === 'interactive-player-refresh') {
        if (!options.executeSection || (section !== 'ranked' && section !== 'stats')) {
          throw new Error('Player refresh handler unavailable')
        }
        await options.executeSection(lease, section, admitSourceCall)
      } else {
        if (
          !options.executeClanSection ||
          !options.syncClanLeaseAuthority ||
          leaseExpiresAt === undefined ||
          (section !== 'profile' && section !== 'roster')
        ) {
          throw new Error('Clan refresh handler unavailable')
        }
        clanAuthority.active = { lease, section }
        await options.syncClanLeaseAuthority(lease, section, leaseExpiresAt)
        await options.executeClanSection(lease, section, admitSourceCall, leaseExpiresAt)
      }
      if (authorityLost.signal.aborted) return
      if ((await operations.commitInteractiveSection(lease, section)) === 'lease-lost') return
    } catch (error) {
      failures.push(error)
    } finally {
      clanAuthority.active = null
    }
  }

  if (authorityLost.signal.aborted) return
  if (failures.length > 0) {
    const retryAware = failures
      .map((error) => ({ error, retryAfterMs: sourceRetryAfterMs(error) }))
      .filter((failure): failure is { error: unknown; retryAfterMs: number } => failure.retryAfterMs !== null)
      .sort((left, right) => right.retryAfterMs - left.retryAfterMs)[0]
    throw retryAware?.error ?? failures[0]
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
  const authorityLost = new AbortController()
  const clanAuthority: { active: ActiveClanAuthority } = { active: null }
  const renewalLoop = renewLease(
    operations,
    lease,
    options.leaseMs,
    options.renewEveryMs ?? Math.max(1, Math.floor(options.leaseMs / 3)),
    renewal.signal,
    clanAuthority,
    authorityLost,
    options,
  )
  try {
    if (lease.kind === 'proof') await executeProof(operations, lease, options)
    else if (lease.kind === 'interactive-player-refresh' || lease.kind === 'clan-refresh') {
      await executeInteractive(operations, lease, options, clanAuthority, authorityLost)
    } else {
      await executeLeaderboard(operations, lease, options)
    }
  } catch (error) {
    if (error instanceof LeaderboardLeaseLostError) return true
    const sourceRetryMs = sourceRetryAfterMs(error)
    const retryDelayMs = sourceRetryMs ?? options.retryDelayMs
    const fallbackCode =
      sourceRetryMs !== null
        ? 'source_rate_limited'
        : lease.kind === 'proof'
          ? 'proof_execution_failed'
          : lease.kind === 'interactive-player-refresh'
            ? 'interactive_player_refresh_failed'
            : lease.kind === 'clan-refresh'
              ? 'clan_refresh_failed'
              : 'leaderboard_collection_failed'
    await operations.fail(lease, failureDetails(error, fallbackCode), retryDelayMs)
  } finally {
    renewal.abort()
    await renewalLoop
  }
  return true
}

export const runOneDurableOperation = runOneRefreshOperation
