import {
  LeaderboardLeaseLostError,
  type LeaderboardPageSource,
  type RankingPublicationStore,
  collectAndPublishLeaderboardGeneration,
  leaderboardModeFromOperationKind,
} from '@brawltome/ranking/composition'
import type {
  AdmissionConfig,
  FencedResult,
  OperationLease,
  RefreshOperationWorker,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission, SourceDomain } from '@brawltome/request-admission'
import type { LifetimeEvidence, RankedEvidence, StatisticsTracer } from '@brawltome/statistics'
import { type Telemetry, observeSourceCall } from '@brawltome/telemetry'

type ProofLease = Extract<OperationLease, { kind: 'proof' }>
type PlayerLease = Extract<OperationLease, { kind: 'interactive-player-refresh' }>
type ClanLease = Extract<OperationLease, { kind: 'clan-refresh' }>
type RankedPulseLease = Extract<OperationLease, { kind: 'ranked-player-pulse' }>
type LeaderboardLease = Extract<OperationLease, { workClass: 'leaderboard' }>
type ProjectionLease = Extract<OperationLease, { payload: { batchSize: number } }>
type ReconciliationLease = Extract<OperationLease, { kind: 'discovery-reconciliation' }>
type StatisticsLease = Extract<OperationLease, { workClass: 'global-statistics' }>
type StatisticsCollectionLease = Extract<
  StatisticsLease,
  { kind: 'statistics-ranked-collection' | 'statistics-lifetime-collection' }
>
type StatisticsPublicationLease = Extract<StatisticsLease, { kind: 'statistics-publication' }>
type InteractiveLease = PlayerLease | ClanLease
type InteractiveSection = InteractiveLease['payload']['staleSections'][number]

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
    caller: 'on-demand' | 'background',
  ): Promise<void>
  executeRankedPulse?(lease: RankedPulseLease, admitSourceCall: (domain: SourceDomain) => Promise<void>): Promise<void>
  isPrimaryMonitoringTarget?(lease: Extract<PlayerLease, { workClass: 'primary-monitoring' }>): Promise<boolean>
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
  statistics?: Pick<
    StatisticsTracer,
    | 'preflightCollection'
    | 'preflightCollectionAttempt'
    | 'recordCollectionAttempt'
    | 'commitObservation'
    | 'preflightPublication'
    | 'validateAndPublish'
  >
  executeStatisticsCollection?(lease: StatisticsCollectionLease): Promise<RankedEvidence | LifetimeEvidence>
  executePlayerProjection?(lease: ProjectionLease): Promise<void>
  executeClanProjection?(lease: ProjectionLease): Promise<void>
  executeDiscoveryReconciliation?(lease: ReconciliationLease): Promise<void>
  projectionEffectState?(
    kind: ProjectionLease['kind'],
    effectOperationId: string,
  ): Promise<'none' | 'applied' | 'acknowledged'>
  playerProjectionEffectState?(effectOperationId: string): Promise<'none' | 'applied' | 'acknowledged'>
  telemetry?: Telemetry
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

type AttemptExecutionOutcome = 'succeeded' | 'retry' | 'dead_letter' | 'lease_lost'

async function executeProof(
  operations: RefreshOperationWorker,
  lease: ProofLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  const effect = options.executeEffect ? await options.executeEffect(lease) : await operations.commitProofEffect(lease)
  if (effect === 'lease-lost') return 'lease_lost'
  if (effect === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'effect_conflict', message: 'Operation key belongs to a different effect', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

function createSourceAdmission(
  options: RunOneRefreshOperationOptions,
  lease: InteractiveLease | RankedPulseLease,
  section: InteractiveSection | 'ranked-pulse',
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
): Promise<AttemptExecutionOutcome> {
  if (!options.sourceAdmission) throw new Error('Interactive refresh dependencies are unavailable')
  const failures: unknown[] = []

  for (const section of lease.payload.staleSections as InteractiveSection[]) {
    if (authorityLost.signal.aborted) return 'lease_lost'
    if (lease.kind === 'interactive-player-refresh' && lease.workClass === 'primary-monitoring') {
      if (!options.isPrimaryMonitoringTarget) throw new Error('Primary monitoring eligibility is unavailable')
      if (!(await options.isPrimaryMonitoringTarget(lease))) {
        return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
      }
    }
    let leaseExpiresAt: Date | undefined
    if (lease.kind === 'clan-refresh') {
      const authority = await operations.renewWithAuthority(lease, options.leaseMs)
      if (authority.outcome === 'lease-lost') {
        authorityLost.abort()
        return 'lease_lost'
      }
      leaseExpiresAt = authority.leaseExpiresAt
    } else if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') {
      authorityLost.abort()
      return 'lease_lost'
    }

    const checkpoint = await operations.beginInteractiveSection(lease, section)
    if (checkpoint === 'lease-lost' || authorityLost.signal.aborted) return 'lease_lost'
    if (checkpoint === 'already-applied') continue

    const admitSourceCall = createSourceAdmission(options, lease, section)
    try {
      if (lease.kind === 'interactive-player-refresh') {
        if (!options.executeSection || (section !== 'ranked' && section !== 'stats')) {
          throw new Error('Player refresh handler unavailable')
        }
        await options.executeSection(
          lease,
          section,
          admitSourceCall,
          lease.workClass === 'primary-monitoring' ? 'background' : 'on-demand',
        )
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
      if (authorityLost.signal.aborted) return 'lease_lost'
      if ((await operations.commitInteractiveSection(lease, section)) === 'lease-lost') return 'lease_lost'
    } catch (error) {
      failures.push(error)
    } finally {
      clanAuthority.active = null
    }
  }

  if (authorityLost.signal.aborted) return 'lease_lost'
  if (failures.length > 0) {
    const retryAware = failures
      .map((error) => ({ error, retryAfterMs: sourceRetryAfterMs(error) }))
      .filter((failure): failure is { error: unknown; retryAfterMs: number } => failure.retryAfterMs !== null)
      .sort((left, right) => right.retryAfterMs - left.retryAfterMs)[0]
    throw retryAware?.error ?? failures[0]
  }
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeDiscoveryProjection(
  operations: RefreshOperationWorker,
  lease: ProjectionLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  const execute =
    lease.kind === 'player-discovery-projection' ? options.executePlayerProjection : options.executeClanProjection
  if (!execute) throw new Error('Discovery projection executor is unavailable')
  await execute(lease)
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeDiscoveryReconciliation(
  operations: RefreshOperationWorker,
  lease: ReconciliationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.executeDiscoveryReconciliation) throw new Error('Discovery reconciliation executor is unavailable')
  await options.executeDiscoveryReconciliation(lease)
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeRankedPulse(
  operations: RefreshOperationWorker,
  lease: RankedPulseLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.executeRankedPulse || !options.sourceAdmission) {
    const transition = await operations.fail(
      lease,
      {
        code: 'ranked_pulse_executor_unavailable',
        message: 'Ranked pulse executor is not configured',
        retryable: false,
      },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  await options.executeRankedPulse(lease, createSourceAdmission(options, lease, 'ranked-pulse'))
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeStatisticsCollection(
  operations: RefreshOperationWorker,
  lease: StatisticsCollectionLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.statistics || !options.executeStatisticsCollection || !options.sourceAdmission) {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_executor_unavailable', message: 'Statistics executor is not configured', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return 'lease_lost'
  const authorization = {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    attemptNumber: lease.attemptNumber,
    cohortId: lease.payload.cohortId,
    brawlhallaId: lease.payload.brawlhallaId,
  }
  const preflight = await options.statistics.preflightCollection(authorization)
  if (preflight === 'already-applied') {
    return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
  }
  if (preflight === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics effect identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  const attemptPreflight = await options.statistics.preflightCollectionAttempt(authorization)
  if (attemptPreflight === 'lease-lost') return 'lease_lost'
  if (attemptPreflight === 'capacity-exceeded') {
    const transition = await operations.fail(
      lease,
      {
        code: 'statistics_capacity_exceeded',
        message: 'Statistics source attempt capacity is exhausted',
        retryable: false,
      },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  if (attemptPreflight === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics attempt identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  const admission = await options.sourceAdmission.admitSource({
    domain: 'brawlhalla-v1',
    reservationKey: `${lease.operationId}:${lease.attemptNumber}:${lease.kind}`,
    units: 1,
  })
  if (admission.outcome === 'rate-limited') throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
  if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return 'lease_lost'
  const attempt = await options.statistics.recordCollectionAttempt(authorization)
  if (attempt === 'lease-lost') return 'lease_lost'
  if (attempt === 'capacity-exceeded') {
    const transition = await operations.fail(
      lease,
      {
        code: 'statistics_capacity_exceeded',
        message: 'Statistics source attempt capacity is exhausted',
        retryable: false,
      },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  if (attempt === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics attempt identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  const evidence = await options.executeStatisticsCollection(lease)
  const committed =
    lease.kind === 'statistics-ranked-collection'
      ? await options.statistics.commitObservation({
          authorization: { ...authorization, kind: lease.kind },
          evidence: evidence as RankedEvidence,
        })
      : await options.statistics.commitObservation({
          authorization: { ...authorization, kind: lease.kind },
          evidence: evidence as LifetimeEvidence,
        })
  if (committed === 'lease-lost') return 'lease_lost'
  if (committed === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics effect identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeStatisticsPublication(
  operations: RefreshOperationWorker,
  lease: StatisticsPublicationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.statistics) {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_executor_unavailable', message: 'Statistics executor is not configured', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return 'lease_lost'
  const authorization = {
    operationId: lease.operationId,
    effectOperationId: lease.effectOperationId,
    operationKey: lease.operationKey,
    kind: lease.kind,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
    generationId: lease.payload.generationId,
    product: lease.payload.product,
  }
  const preflight = await options.statistics.preflightPublication(authorization)
  if (preflight === 'already-applied') {
    return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
  }
  if (preflight === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics publication identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  const published = await options.statistics.validateAndPublish(authorization)
  if (published.result === 'lease-lost') return 'lease_lost'
  if (published.result === 'collection-active') {
    const transition = await operations.defer(
      lease,
      {
        code: 'statistics_collection_active',
        message: 'Statistics collection replay is still active',
        retryable: true,
      },
      options.retryDelayMs,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'retry'
  }
  if (published.result === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      { code: 'statistics_effect_conflict', message: 'Statistics publication identity conflicts', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeLeaderboard(
  operations: RefreshOperationWorker,
  lease: LeaderboardLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.ranking || !options.leaderboardSource || !options.sourceAdmission) {
    const transition = await operations.fail(
      lease,
      { code: 'leaderboard_executor_unavailable', message: 'Leaderboard executor is not configured', retryable: false },
      0,
    )
    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }
  const { leaderboardSource, ranking, sourceAdmission } = options
  const renewLeaderboardLease = async () => {
    if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') throw new LeaderboardLeaseLostError()
  }
  const mode = leaderboardModeFromOperationKind(lease.kind)
  await collectAndPublishLeaderboardGeneration({
    mode,
    authorization: {
      operationId: lease.operationId,
      effectOperationId: lease.effectOperationId,
      operationKey: lease.operationKey,
      operationKind: lease.kind,
      leaseOwner: lease.leaseOwner,
      leaseToken: lease.leaseToken,
      scheduleWindowAt: lease.scheduleWindowAt,
    },
    source: {
      async fetchPage(input) {
        await renewLeaderboardLease()
        const admission = await sourceAdmission.admitSource({
          domain: 'brawlhalla-v1',
          reservationKey: `${lease.operationId}:${lease.attemptNumber}:${input.mode}:${input.region}:${input.page}`,
          units: 1,
        })
        if (admission.outcome === 'rate-limited') throw new SourceAdmissionLimitedError(admission.retryAfterSeconds)
        await renewLeaderboardLease()
        return options.telemetry
          ? observeSourceCall(options.telemetry, 'brawlhalla-v1', () => leaderboardSource.fetchPage(input))
          : leaderboardSource.fetchPage(input)
      },
    },
    publication: ranking,
    pageDepth: lease.payload.pageDepth,
    intervalMs: lease.payload.intervalMs,
  })
  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

export async function runOneRefreshOperation(
  operations: RefreshOperationWorker,
  workerId: string,
  options: RunOneRefreshOperationOptions,
): Promise<boolean> {
  const claimed = await operations.claim(workerId, options.leaseMs, options.admission)
  if (!claimed) return false
  const lease: OperationLease = claimed

  const telemetry = options.telemetry
  const started = performance.now()
  let attemptOutcome: 'succeeded' | 'retry' | 'dead_letter' | 'lease_lost' = 'succeeded'
  let failureCategory: 'source_rate_limited' | 'execution' | 'lease_lost' | 'unknown' = 'unknown'

  function record(recording: (active: Telemetry) => void): void {
    if (!telemetry) return
    try {
      recording(telemetry)
    } catch {
      return
    }
  }

  async function executeClaimed(): Promise<boolean> {
    record((active) =>
      active.logger.info('operation.attempt.started', {
        operationId: lease.operationId,
        effectOperationId: lease.effectOperationId,
        attemptNumber: lease.attemptNumber,
        kind: lease.kind,
        workClass: lease.workClass,
        scheduled: lease.scheduleWindowAt !== null,
      }),
    )
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
      if (lease.kind === 'proof') attemptOutcome = await executeProof(operations, lease, options)
      else if (lease.kind === 'interactive-player-refresh' || lease.kind === 'clan-refresh') {
        attemptOutcome = await executeInteractive(operations, lease, options, clanAuthority, authorityLost)
      } else if (lease.kind === 'player-discovery-projection' || lease.kind === 'clan-discovery-projection') {
        attemptOutcome = await executeDiscoveryProjection(operations, lease, options)
      } else if (lease.kind === 'discovery-reconciliation') {
        attemptOutcome = await executeDiscoveryReconciliation(operations, lease, options)
      } else if (lease.kind === 'ranked-player-pulse') {
        attemptOutcome = await executeRankedPulse(operations, lease, options)
      } else if (lease.kind === 'statistics-publication') {
        attemptOutcome = await executeStatisticsPublication(operations, lease, options)
      } else if (lease.workClass === 'global-statistics') {
        attemptOutcome = await executeStatisticsCollection(operations, lease, options)
      } else {
        attemptOutcome = await executeLeaderboard(operations, lease, options)
      }
      if (attemptOutcome === 'lease_lost') failureCategory = 'lease_lost'
    } catch (error) {
      if (error instanceof LeaderboardLeaseLostError) {
        attemptOutcome = 'lease_lost'
        failureCategory = 'lease_lost'
        return true
      }
      if (
        error instanceof SourceAdmissionLimitedError &&
        (lease.kind === 'statistics-ranked-collection' || lease.kind === 'statistics-lifetime-collection')
      ) {
        const transition = await operations.defer(
          lease,
          { code: 'source_rate_limited', message: error.message, retryable: true },
          error.retryAfterSeconds * 1_000,
        )
        attemptOutcome = transition === 'lease-lost' ? 'lease_lost' : 'retry'
        failureCategory = transition === 'lease-lost' ? 'lease_lost' : 'source_rate_limited'
        return true
      }
      if (lease.kind === 'player-discovery-projection' || lease.kind === 'clan-discovery-projection') {
        let effectState: 'none' | 'applied' | 'acknowledged'
        try {
          effectState = options.projectionEffectState
            ? await options.projectionEffectState(lease.kind, lease.effectOperationId)
            : lease.kind === 'player-discovery-projection' && options.playerProjectionEffectState
              ? await options.playerProjectionEffectState(lease.effectOperationId)
              : 'none'
        } catch {
          const transition = await operations.retryAppliedDiscoveryProjection(lease, options.retryDelayMs)
          attemptOutcome = transition === 'lease-lost' ? 'lease_lost' : 'retry'
          failureCategory = transition === 'lease-lost' ? 'lease_lost' : 'execution'
          return true
        }
        if (effectState === 'acknowledged') {
          const transition = await operations.complete(lease)
          attemptOutcome = transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
          failureCategory = transition === 'lease-lost' ? 'lease_lost' : 'unknown'
          return true
        }
        if (effectState === 'applied') {
          const transition = await operations.retryAppliedDiscoveryProjection(lease, options.retryDelayMs)
          attemptOutcome = transition === 'lease-lost' ? 'lease_lost' : 'retry'
          failureCategory = transition === 'lease-lost' ? 'lease_lost' : 'execution'
          return true
        }
      }
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
                : lease.kind === 'player-discovery-projection'
                  ? 'player_discovery_projection_failed'
                  : lease.kind === 'clan-discovery-projection'
                    ? 'clan_discovery_projection_failed'
                    : lease.kind === 'discovery-reconciliation'
                      ? 'discovery_reconciliation_failed'
                      : lease.kind === 'ranked-player-pulse'
                        ? 'ranked_player_pulse_failed'
                        : lease.kind === 'statistics-ranked-collection' ||
                            lease.kind === 'statistics-lifetime-collection'
                          ? 'statistics_collection_failed'
                          : lease.kind === 'statistics-publication'
                            ? 'statistics_publication_failed'
                            : 'leaderboard_collection_failed'
      const failure = failureDetails(error, fallbackCode)
      attemptOutcome = failure.retryable && lease.attemptNumber < lease.maxAttempts ? 'retry' : 'dead_letter'
      failureCategory = sourceRetryMs !== null ? 'source_rate_limited' : 'execution'
      if ((await operations.fail(lease, failure, retryDelayMs)) === 'lease-lost') {
        attemptOutcome = 'lease_lost'
        failureCategory = 'lease_lost'
      }
      record((active) =>
        active.logger.error('operation.attempt.failed', error, {
          operationId: lease.operationId,
          effectOperationId: lease.effectOperationId,
          attemptNumber: lease.attemptNumber,
          kind: lease.kind,
          workClass: lease.workClass,
          outcome: attemptOutcome,
          failureCategory,
        }),
      )
    } finally {
      renewal.abort()
      await renewalLoop
      const labels = { kind: lease.kind, work_class: lease.workClass, outcome: attemptOutcome }
      record((active) => {
        active.metrics.add('operation_attempts_total', 1, labels)
        active.metrics.observe('operation_duration_ms', performance.now() - started, labels)
        if (attemptOutcome !== 'succeeded') {
          active.metrics.add('refresh_failures_total', 1, { kind: lease.kind, failure_category: failureCategory })
        }
        active.logger.info('operation.attempt.completed', {
          operationId: lease.operationId,
          effectOperationId: lease.effectOperationId,
          attemptNumber: lease.attemptNumber,
          kind: lease.kind,
          workClass: lease.workClass,
          outcome: attemptOutcome,
          durationMs: performance.now() - started,
        })
      })
    }
    return true
  }

  if (!telemetry) return executeClaimed()
  const context = telemetry.childContext()
  return telemetry.run(context, () =>
    telemetry.trace(
      'operation.attempt',
      { kind: lease.kind, workClass: lease.workClass, attemptNumber: lease.attemptNumber },
      executeClaimed,
    ),
  )
}

export const runOneDurableOperation = runOneRefreshOperation
