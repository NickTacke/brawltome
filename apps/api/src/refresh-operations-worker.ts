import {
  collectAndPublishLeaderboardGeneration,
  type LeaderboardDeepCrawlStanding,
  type LeaderboardDeepCrawlTeam,
  type LeaderboardGenerationCandidate,
  LeaderboardLeaseLostError,
  type LeaderboardPageSource,
  LeaderboardSourceError,
  leaderboardDeepCrawlStandings,
  leaderboardDeepCrawlTeams,
  leaderboardModeFromOperationKind,
  type RankingPublicationStore,
  type RankingRetentionStore,
} from '@brawltome/ranking'
import {
  type AdmissionConfig,
  decideExecutionFailure,
  decideSourceFailure,
  type FailureDecision,
  type FencedResult,
  failureDetails,
  type OperationLease,
  type RefreshOperationWorker,
  type RetryTimings,
  SourceAdmissionLimitedError,
  sourceRetryAfterMs,
  sourceWaitMs,
  type TransitionResult,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission, SourceDomain } from '@brawltome/request-admission'
import type { LifetimeEvidence, RankedEvidence, StatisticsTracer } from '@brawltome/statistics'
import { observeSourceCall, type Telemetry } from '@brawltome/telemetry'

type ProofLease = Extract<OperationLease, { kind: 'proof' }>
type PlayerLease = Extract<OperationLease, { kind: 'interactive-player-refresh' }>
type ClanLease = Extract<OperationLease, { kind: 'clan-refresh' }>
type RankedPulseLease = Extract<OperationLease, { kind: 'ranked-player-pulse' }>
type NameVerificationLease = Extract<OperationLease, { kind: 'player-name-verification' }>
type RankingRetentionLease = Extract<OperationLease, { kind: 'ranking-retention' }>
type LeaderboardDeepCrawlLease = Extract<OperationLease, { kind: 'leaderboard-deep-crawl' }>
type LeaderboardLease = Exclude<Extract<OperationLease, { workClass: 'leaderboard' }>, LeaderboardDeepCrawlLease>
type ProjectionLease = Extract<OperationLease, { payload: { batchSize: number } }>
type ReconciliationLease = Extract<OperationLease, { kind: 'discovery-reconciliation' }>
type StatisticsLease = Extract<OperationLease, { workClass: 'global-statistics' }>
type StatisticsCollectionLease = Extract<
  StatisticsLease,
  { kind: 'statistics-ranked-collection' | 'statistics-lifetime-collection' }
>
type StatisticsPublicationLease = Extract<StatisticsLease, { kind: 'statistics-publication' }>
type StatisticsLegendMetaPublicationLease = Extract<StatisticsLease, { kind: 'statistics-legend-meta-publication' }>
type InteractiveLease = PlayerLease | ClanLease
type InteractiveSection = InteractiveLease['payload']['staleSections'][number]

export type RetryBackoff = {
  multiplier: number
  maxDelayMs: number
  jitterRatio: number
  random?: () => number
}

type RunOneRefreshOperationOptions = {
  leaseMs: number
  retryDelayMs: number
  retryBackoff?: RetryBackoff
  sourceUnavailableRetryMs?: number
  admission: AdmissionConfig
  renewEveryMs?: number
  sourceAdmission?: SourceAdmission
  waitForSourceAdmission?: (retryAfterMs: number, signal: AbortSignal) => Promise<void>
  waitForSourceRetry?: (delayMs: number, signal: AbortSignal) => Promise<void>
  executeEffect?: (lease: ProofLease) => Promise<FencedResult>
  executeSection?(
    lease: PlayerLease,
    section: 'ranked' | 'stats',
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
    caller: 'on-demand' | 'background',
  ): Promise<void>
  executeRankedPulse?(lease: RankedPulseLease, admitSourceCall: (domain: SourceDomain) => Promise<void>): Promise<void>
  executePlayerNameVerification?(
    lease: NameVerificationLease,
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
  ): Promise<unknown>
  isPrimaryMonitoringTarget?(lease: AccountPrimaryLease): Promise<boolean>
  executeClanSection?(
    lease: ClanLease,
    section: 'profile' | 'roster',
    admitSourceCall: (domain: SourceDomain) => Promise<void>,
    leaseExpiresAt: Date,
  ): Promise<void>
  syncClanLeaseAuthority?(lease: ClanLease, section: 'profile' | 'roster', leaseExpiresAt: Date): Promise<void>
  revokeClanLeaseAuthority?(lease: ClanLease, section: 'profile' | 'roster'): Promise<void>
  ranking?: RankingPublicationStore
  rankingRetention?: RankingRetentionStore
  // Explicitly false pauses retention: runs already materialized complete without deleting anything.
  rankingRetentionEnabled?: boolean
  leaderboardPlayerNames?: {
    applyLeaderboardNames(input: {
      observedAt: Date
      players: Array<{ brawlhallaId: number; name: string }>
    }): Promise<{ changed: number }>
  }
  leaderboardRanked?: {
    applyLeaderboardRanked(input: {
      observedAt: Date
      players: Array<{
        brawlhallaId: number
        region: string
        rating: number
        peakRating: number
        tier: string | null
        wins: number
        games: number
      }>
    }): Promise<{ changed: number }>
  }
  leaderboardSource?: LeaderboardPageSource
  leaderboardDeepCrawlProgress?: {
    read(mode: string, region: string): Promise<{ windowAt: Date; nextPage: number; totalPages: number } | null>
    save(input: { mode: string; region: string; windowAt: Date; nextPage: number; totalPages: number }): Promise<void>
  }
  leaderboardTeamModes?: {
    applyLeaderboardSoloQueue(input: {
      observedAt: Date
      players: Array<{
        brawlhallaId: number
        region: string
        rating: number
        peakRating: number
        tier: string | null
        wins: number
        games: number
      }>
    }): Promise<{ changed: number }>
    applyLeaderboardTeams(input: {
      observedAt: Date
      teams: Array<{
        brawlhallaIdOne: number
        brawlhallaIdTwo: number
        region: string
        rating: number
        peakRating: number
        tier: string | null
        wins: number
        games: number
      }>
    }): Promise<{ changed: number }>
  }
  deepCrawlSlicePages?: number
  deepCrawlPageDelayMs?: number
  statistics?: Pick<
    StatisticsTracer,
    | 'preflightCollection'
    | 'preflightCollectionAttempt'
    | 'recordCollectionAttempt'
    | 'commitObservation'
    | 'preflightPublication'
    | 'validateAndPublish'
    | 'preflightLegendMetaPublication'
    | 'buildAndPublishLegendMeta'
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

export function retryDelayForAttempt(
  attemptNumber: number,
  policy: { baseDelayMs: number; multiplier: number; maxDelayMs: number; jitterRatio: number; random: () => number },
): number {
  const exponent = Math.max(0, attemptNumber - 1)
  const nominal = policy.baseDelayMs * policy.multiplier ** exponent
  const jitter = 1 + policy.jitterRatio * (2 * policy.random() - 1)

  return Math.max(0, Math.min(policy.maxDelayMs, Math.floor(nominal * jitter)))
}

function executionRetryDelayMs(lease: OperationLease, options: RunOneRefreshOperationOptions): number {
  if (!options.retryBackoff) return options.retryDelayMs

  return retryDelayForAttempt(lease.attemptNumber, {
    baseDelayMs: options.retryDelayMs,
    multiplier: options.retryBackoff.multiplier,
    maxDelayMs: options.retryBackoff.maxDelayMs,
    jitterRatio: options.retryBackoff.jitterRatio,
    random: options.retryBackoff.random ?? Math.random,
  })
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

const safeFailureCode = /^[a-z0-9_.-]{1,64}$/i

type AttemptExecutionOutcome = 'succeeded' | 'retry' | 'dead_letter' | 'lease_lost'

type FailureCategory =
  | 'admission_deferred'
  | 'source_rate_limited'
  | 'source_unavailable'
  | 'execution'
  | 'lease_lost'
  | 'unknown'

type FailureSettlement = { outcome: AttemptExecutionOutcome; category: FailureCategory }

// a new lease kind fails typecheck here until it names its failure code
const failureCodeByKind: Record<OperationLease['kind'], string> = {
  proof: 'proof_execution_failed',
  'interactive-player-refresh': 'interactive_player_refresh_failed',
  'clan-refresh': 'clan_refresh_failed',
  'player-discovery-projection': 'player_discovery_projection_failed',
  'clan-discovery-projection': 'clan_discovery_projection_failed',
  'discovery-reconciliation': 'discovery_reconciliation_failed',
  'ranked-player-pulse': 'ranked_player_pulse_failed',
  'player-name-verification': 'player_name_verification_failed',
  'ranking-retention': 'ranking_retention_failed',
  'leaderboard-deep-crawl': 'leaderboard_deep_crawl_failed',
  'statistics-ranked-collection': 'statistics_collection_failed',
  'statistics-lifetime-collection': 'statistics_collection_failed',
  'statistics-publication': 'statistics_publication_failed',
  'statistics-legend-meta-publication': 'statistics_legend_meta_publication_failed',
  'leaderboard-1v1': 'leaderboard_collection_failed',
  'leaderboard-2v2': 'leaderboard_collection_failed',
  'leaderboard-solo-2v2': 'leaderboard_collection_failed',
  'leaderboard-3v3': 'leaderboard_collection_failed',
}

const leaseLostSettlement: FailureSettlement = { outcome: 'lease_lost', category: 'lease_lost' }

function recordTelemetry(telemetry: Telemetry | undefined, recording: (active: Telemetry) => void): void {
  if (!telemetry) return

  try {
    recording(telemetry)
  } catch {
    return
  }
}

function isProjectionLease(lease: OperationLease): lease is ProjectionLease {
  return lease.kind === 'player-discovery-projection' || lease.kind === 'clan-discovery-projection'
}

function decideRankingFailure(error: unknown, retry: RetryTimings): FailureDecision | null {
  if (error instanceof LeaderboardLeaseLostError) return { action: 'lease-lost' }

  if (error instanceof LeaderboardDeepCrawlYield) {
    return {
      action: 'defer',
      failure: { code: 'deep_crawl_yield', message: error.message, retryable: true },
      delayMs: 0,
      category: 'admission_deferred',
    }
  }

  if (error instanceof LeaderboardSourceError && error.retryable) {
    return {
      action: 'defer',
      failure: failureDetails(error, error.code),
      delayMs: sourceWaitMs(retry),
      category: error.code === 'source_rate_limited' ? 'source_rate_limited' : 'source_unavailable',
    }
  }

  return null
}

// Asks the executor of a discovery projection whether its effect already landed before the attempt failed.
async function decideProjectionEffectFailure(
  lease: OperationLease,
  options: RunOneRefreshOperationOptions,
): Promise<FailureDecision | null> {
  if (!isProjectionLease(lease)) return null

  let effectState: 'none' | 'applied' | 'acknowledged' = 'none'

  try {
    if (options.projectionEffectState) {
      effectState = await options.projectionEffectState(lease.kind, lease.effectOperationId)
    } else if (lease.kind === 'player-discovery-projection' && options.playerProjectionEffectState) {
      effectState = await options.playerProjectionEffectState(lease.effectOperationId)
    }
  } catch {
    return { action: 'retry-applied-effect' }
  }

  if (effectState === 'acknowledged') return { action: 'complete' }

  if (effectState === 'applied') return { action: 'retry-applied-effect' }

  return null
}

// Checks run in a fixed order: ranking errors, then what the source says, then the projection effect, then a plain
// failure. A source outage on a projection whose effect landed must still wait for the source.
async function decideJobFailure(
  lease: OperationLease,
  error: unknown,
  options: RunOneRefreshOperationOptions,
): Promise<FailureDecision> {
  const retry = {
    retryDelayMs: options.retryDelayMs,
    sourceUnavailableRetryMs: options.sourceUnavailableRetryMs ?? 60_000,
  }

  const rankingDecision = decideRankingFailure(error, retry)

  if (rankingDecision) return rankingDecision

  const sourceDecision = decideSourceFailure(error, retry)

  if (sourceDecision) return sourceDecision

  const effectDecision = await decideProjectionEffectFailure(lease, options)

  if (effectDecision) return effectDecision

  return decideExecutionFailure(error, failureCodeByKind[lease.kind], executionRetryDelayMs(lease, options))
}

function settledUnlessLeaseLost(transition: TransitionResult, settled: FailureSettlement): FailureSettlement {
  return transition === 'lease-lost' ? leaseLostSettlement : settled
}

// Pausing the source holds every other caller too, instead of each discovering the outage on its own.
async function pauseSource(
  options: RunOneRefreshOperationOptions,
  pause: { domain: SourceDomain; seconds: number },
): Promise<void> {
  try {
    await options.sourceAdmission?.pauseSource(pause.domain, pause.seconds)
  } catch (pauseError) {
    recordTelemetry(options.telemetry, (active) =>
      active.logger.error('source.backoff.persist_failed', pauseError, { domain: pause.domain }),
    )
  }
}

async function settleFailure(
  operations: RefreshOperationWorker,
  lease: OperationLease,
  options: RunOneRefreshOperationOptions,
  decision: FailureDecision,
): Promise<FailureSettlement> {
  if (decision.action === 'lease-lost') return leaseLostSettlement

  if (decision.action === 'complete') {
    const transition = await operations.complete(lease)

    return settledUnlessLeaseLost(transition, { outcome: 'succeeded', category: 'unknown' })
  }

  if (decision.action === 'retry-applied-effect') {
    if (!isProjectionLease(lease)) {
      throw new Error(`settle failure for operation ${lease.operationId}: ${lease.kind} has no applied effect to retry`)
    }

    const transition = await operations.retryAppliedDiscoveryProjection(lease, options.retryDelayMs)

    return settledUnlessLeaseLost(transition, { outcome: 'retry', category: 'execution' })
  }

  if (decision.action === 'defer') {
    if (decision.pauseSource) await pauseSource(options, decision.pauseSource)

    const transition = await operations.defer(lease, decision.failure, decision.delayMs)

    return settledUnlessLeaseLost(transition, { outcome: 'retry', category: decision.category })
  }

  const transition = await operations.fail(lease, decision.failure, decision.delayMs)
  const hasAttemptsLeft = decision.failure.retryable && lease.attemptNumber < lease.maxAttempts

  return settledUnlessLeaseLost(transition, {
    outcome: hasAttemptsLeft ? 'retry' : 'dead_letter',
    category: decision.category,
  })
}

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
  lease: InteractiveLease | RankedPulseLease | NameVerificationLease,
  section: InteractiveSection | 'ranked-pulse' | 'name-verification',
): (domain: SourceDomain) => Promise<void> {
  let sourceCall = 0

  return async (domain) => {
    const sourceAdmission = await options.sourceAdmission?.admitSource({
      domain,
      reservationKey: `${lease.operationId}:${section}:${lease.attemptNumber}:${sourceCall++}`,
      units: 1,
      caller: lease.workClass === 'interactive' ? 'on-demand' : 'background',
    })

    if (!sourceAdmission) throw new Error('Source admission is unavailable')

    if (sourceAdmission.outcome === 'rate-limited') {
      throw new SourceAdmissionLimitedError(sourceAdmission.retryAfterSeconds)
    }
  }
}

type AccountPrimaryLease = Extract<PlayerLease, { workClass: 'primary-monitoring'; payload: { assignmentId: string } }>

function isAccountPrimaryLease(lease: InteractiveLease): lease is AccountPrimaryLease {
  return (
    lease.kind === 'interactive-player-refresh' &&
    lease.workClass === 'primary-monitoring' &&
    'assignmentId' in lease.payload
  )
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

    // Account Primary refreshes stop once their assignment ends; recently viewed refreshes belong to no account.
    if (isAccountPrimaryLease(lease)) {
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
    const executionFailure = failures.find((error) => sourceRetryAfterMs(error) === null)

    if (executionFailure) throw executionFailure

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

// The executor spends at most one V0 call and records its own outcome, so only a lost lease fails the attempt.
async function executeNameVerification(
  operations: RefreshOperationWorker,
  lease: NameVerificationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.executePlayerNameVerification || !options.sourceAdmission) {
    const transition = await operations.fail(
      lease,
      {
        code: 'name_verification_executor_unavailable',
        message: 'Player name verification executor is not configured',
        retryable: false,
      },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return 'lease_lost'

  await options.executePlayerNameVerification(lease, createSourceAdmission(options, lease, 'name-verification'))

  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

// Expires one bounded batch of old leaderboard generations. The lease check, the delete and the operation's
// completion commit in one transaction, so a batch that outlives its lease is still recorded as succeeded.
async function executeRankingRetention(
  operations: RefreshOperationWorker,
  lease: RankingRetentionLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (options.rankingRetentionEnabled === false) {
    const transition = await operations.complete(lease)

    if (transition === 'lease-lost') return 'lease_lost'

    try {
      options.telemetry?.logger.info('ranking.retention.skipped', {
        operationId: lease.operationId,
        reason: 'disabled',
        deletedGenerations: 0,
      })
    } catch {
      // Telemetry never decides the outcome of committed work.
    }

    return 'succeeded'
  }

  if (!options.rankingRetention) {
    const transition = await operations.fail(
      lease,
      {
        code: 'ranking_retention_executor_unavailable',
        message: 'Ranking retention executor is not configured',
        retryable: false,
      },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') return 'lease_lost'

  const started = performance.now()

  const result = await options.rankingRetention.expireGenerations(
    { operationId: lease.operationId, leaseOwner: lease.leaseOwner, leaseToken: lease.leaseToken },
    lease.payload,
  )

  if (result.outcome === 'lease-lost') return 'lease_lost'

  const telemetry = options.telemetry

  if (telemetry) {
    try {
      const durationMs = Math.round(performance.now() - started)

      telemetry.metrics.add('ranking_retention_deleted_generations_total', result.deletedGenerations, {})
      telemetry.metrics.set('ranking_retention_expirable_generations', result.expirableGenerations, {})
      telemetry.metrics.observe('ranking_retention_duration_ms', durationMs, {})

      telemetry.logger.info('ranking.retention.completed', {
        operationId: lease.operationId,
        deletedGenerations: result.deletedGenerations,
        retentionHours: lease.payload.retentionHours,
        maxGenerations: lease.payload.maxGenerations,
        // A full batch means more expired generations are waiting for the next run.
        batchFull: result.deletedGenerations >= lease.payload.maxGenerations,
        expirableGenerations: result.expirableGenerations,
        durationMs,
      })
    } catch {
      // Telemetry never decides the outcome of committed work.
    }
  }

  return 'succeeded'
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
    caller: 'background',
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

async function executeStatisticsLegendMetaPublication(
  operations: RefreshOperationWorker,
  lease: StatisticsLegendMetaPublicationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptExecutionOutcome> {
  if (!options.statistics) {
    const transition = await operations.fail(
      lease,
      {
        code: 'statistics_executor_unavailable',
        message: 'Statistics executor is not configured',
        retryable: false,
      },
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
  }

  const preflight = await options.statistics.preflightLegendMetaPublication(authorization)

  if (preflight === 'already-applied') {
    return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
  }

  if (preflight === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      {
        code: 'statistics_legend_meta_effect_conflict',
        message: 'Statistics Legend Meta publication identity conflicts',
        retryable: false,
      },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  const published = await options.statistics.buildAndPublishLegendMeta(authorization)

  if (published.result === 'lease-lost') return 'lease_lost'

  if (published.result === 'prerequisite-missing') {
    const transition = await operations.defer(
      lease,
      {
        code: 'statistics_legend_meta_prerequisite_missing',
        message: 'Statistics ranked validation decision is not available yet',
        retryable: true,
      },
      options.retryDelayMs,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'retry'
  }

  if (published.result === 'effect-conflict') {
    const transition = await operations.fail(
      lease,
      {
        code: 'statistics_legend_meta_effect_conflict',
        message: 'Statistics Legend Meta publication identity conflicts',
        retryable: false,
      },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

// Transient V1 page failures retry in place; 429s stay with durable rate-limit backoff.
const leaderboardPageRetryDelaysMs = [500, 2_000] as const

function isTransientLeaderboardPageFailure(error: unknown): boolean {
  return (
    error instanceof LeaderboardSourceError &&
    error.retryable &&
    (error.code === 'source_transport_failed' || error.code === 'source_unavailable')
  )
}

function leaderboardContestants(candidate: LeaderboardGenerationCandidate) {
  const contestants = new Map<number, string>()

  for (const rows of candidate.snapshots.values()) {
    for (const { identity } of rows) {
      const players = identity.type === 'fixed-two-vs-two-team' ? identity.players : [identity.player]

      for (const player of players) {
        if (!contestants.has(player.brawlhallaId)) contestants.set(player.brawlhallaId, player.name)
      }
    }
  }

  return [...contestants].map(([brawlhallaId, name]) => ({ brawlhallaId, name }))
}

function oneVsOneStandings(candidate: LeaderboardGenerationCandidate) {
  const standings = new Map<
    number,
    {
      brawlhallaId: number
      region: string
      rating: number
      peakRating: number
      tier: string | null
      wins: number
      games: number
    }
  >()

  for (const rows of candidate.snapshots.values()) {
    for (const row of rows) {
      if (row.identity.type !== 'one-vs-one-player') continue

      const { brawlhallaId } = row.identity.player

      if (standings.has(brawlhallaId)) continue

      standings.set(brawlhallaId, {
        brawlhallaId,
        region: row.region,
        rating: row.rating,
        peakRating: row.peakRating,
        tier: row.tier,
        wins: row.wins,
        games: row.wins + row.losses,
      })
    }
  }

  return [...standings.values()]
}

// Leaderboards observe current names and 1v1 standings for thousands of players nobody visits; feed them to Players
// after the generation is durable. Failure only delays them until the next scan, so it never fails the publication.
function withLeaderboardNamePropagation(
  ranking: RankingPublicationStore,
  names: RunOneRefreshOperationOptions['leaderboardPlayerNames'],
  standings: RunOneRefreshOperationOptions['leaderboardRanked'],
  telemetry: Telemetry | undefined,
): RankingPublicationStore {
  if (!names && !standings) return ranking

  return {
    recordCollectionFailure: (authorization, failure) => ranking.recordCollectionFailure(authorization, failure),
    async publishGeneration(authorization, candidate) {
      const result = await ranking.publishGeneration(authorization, candidate)

      if (result !== 'published' && result !== 'already-published') return result

      const log = (write: (active: Telemetry) => void) => {
        if (!telemetry) return

        try {
          write(telemetry)
        } catch {
          return
        }
      }

      if (names) {
        try {
          const { changed } = await names.applyLeaderboardNames({
            observedAt: candidate.observedAt,
            players: leaderboardContestants(candidate),
          })

          log((active) => active.logger.info('leaderboard.player_names.applied', { mode: candidate.mode, changed }))
        } catch (error) {
          log((active) => active.logger.error('leaderboard.player_names.failed', error, { mode: candidate.mode }))
        }
      }

      if (standings && candidate.mode === '1v1') {
        try {
          const { changed } = await standings.applyLeaderboardRanked({
            observedAt: candidate.observedAt,
            players: oneVsOneStandings(candidate),
          })

          log((active) => active.logger.info('leaderboard.player_ranked.applied', { mode: candidate.mode, changed }))
        } catch (error) {
          log((active) => active.logger.error('leaderboard.player_ranked.failed', error, { mode: candidate.mode }))
        }
      }

      return result
    },
  }
}

// Fetches one V1 leaderboard page with background source admission, renewing the lease around each wait and retrying
// transient page failures in place.
function admittedLeaderboardPageFetch(
  operations: RefreshOperationWorker,
  lease: LeaderboardLease | LeaderboardDeepCrawlLease,
  options: RunOneRefreshOperationOptions,
  sourceAdmission: SourceAdmission,
  leaderboardSource: LeaderboardPageSource,
  authorityLost: AbortSignal,
): LeaderboardPageSource['fetchPage'] {
  const renewLeaderboardLease = async () => {
    if ((await operations.renew(lease, options.leaseMs)) === 'lease-lost') throw new LeaderboardLeaseLostError()
  }

  return async (input) => {
    const pageKey = `${lease.operationId}:${lease.leaseToken}:${input.mode}:${input.region}:${input.page}`

    for (let retry = 0; ; retry += 1) {
      await renewLeaderboardLease()
      for (;;) {
        const admission = await sourceAdmission.admitSource({
          domain: 'brawlhalla-v1',
          // Each retry is a real source call, so it needs its own reservation.
          reservationKey: retry === 0 ? pageKey : `${pageKey}:retry-${retry}`,
          units: 1,
          caller: 'background',
        })

        if (admission.outcome === 'admitted') break

        await (options.waitForSourceAdmission ?? waitForRenewal)(admission.retryAfterSeconds * 1_000, authorityLost)
        if (authorityLost.aborted) throw new LeaderboardLeaseLostError()

        await renewLeaderboardLease()
      }

      await renewLeaderboardLease()
      try {
        return await (options.telemetry
          ? observeSourceCall(options.telemetry, 'brawlhalla-v1', () => leaderboardSource.fetchPage(input))
          : leaderboardSource.fetchPage(input))
      } catch (error) {
        const delayMs = leaderboardPageRetryDelaysMs[retry]

        if (delayMs === undefined || !isTransientLeaderboardPageFailure(error)) throw error

        await (options.waitForSourceRetry ?? waitForRenewal)(delayMs, authorityLost)
        if (authorityLost.aborted) throw new LeaderboardLeaseLostError()
      }
    }
  }
}

const deepCrawlChunkPages = 20
const defaultDeepCrawlSlicePages = 100

// Thrown after a slice so the crawl gives the leaderboard slot back; the worker defers it without spending an attempt
// and the regular 15-minute collections, queued earlier, run first.
export class LeaderboardDeepCrawlYield extends Error {
  constructor() {
    super('Leaderboard deep crawl yielded between slices')
  }
}

// Reads every V1 leaderboard page of one mode and region in slices, writing each chunk of pages straight to Players without
// publishing a ranking generation. Progress is saved per chunk, so a yielded, failed, or interrupted crawl resumes.
async function executeLeaderboardDeepCrawl(
  operations: RefreshOperationWorker,
  lease: LeaderboardDeepCrawlLease,
  options: RunOneRefreshOperationOptions,
  authorityLost: AbortSignal,
): Promise<AttemptExecutionOutcome> {
  const { leaderboardSource, sourceAdmission, leaderboardPlayerNames, leaderboardRanked, leaderboardTeamModes } =
    options

  const mode = lease.payload.mode ?? '1v1'

  if (
    !leaderboardSource ||
    !sourceAdmission ||
    (mode === '1v1' ? !leaderboardPlayerNames || !leaderboardRanked : !leaderboardTeamModes)
  ) {
    const transition = await operations.fail(
      lease,
      {
        code: 'leaderboard_executor_unavailable',
        message: 'Leaderboard deep crawl executor is not configured',
        retryable: false,
      },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  const { region } = lease.payload
  const progress = options.leaderboardDeepCrawlProgress
  const slicePages = options.deepCrawlSlicePages ?? defaultDeepCrawlSlicePages
  const windowAt = new Date(lease.scheduleWindowAt ?? lease.effectCreatedAt)

  const fetchPage = admittedLeaderboardPageFetch(
    operations,
    lease,
    options,
    sourceAdmission,
    leaderboardSource,
    authorityLost,
  )

  const record = (write: (active: Telemetry) => void) => {
    if (!options.telemetry) return

    try {
      write(options.telemetry)
    } catch {
      return
    }
  }

  const started = performance.now()
  const saved = await progress?.read(mode, region)
  const resuming = saved !== undefined && saved !== null && saved.windowAt.getTime() === windowAt.getTime()
  let page = resuming ? saved.nextPage : 1
  let totalPages = resuming ? saved.totalPages : 1
  let chunk: LeaderboardDeepCrawlStanding[] = []
  let teamChunk: LeaderboardDeepCrawlTeam[] = []
  let chunkObservedAt = new Date()
  let changedNames = 0
  let changedStandings = 0
  let pagesRead = 0
  let pagesSkipped = 0

  const changed = (change: 'name' | 'standing' | 'solo' | 'team', count: number) =>
    record((active) => active.metrics.add('leaderboard_deep_crawl_changed_total', count, { mode, region, change }))

  const flush = async () => {
    if (chunk.length > 0 && mode === '1v1' && leaderboardPlayerNames && leaderboardRanked) {
      const names = await leaderboardPlayerNames.applyLeaderboardNames({
        observedAt: chunkObservedAt,
        players: chunk.map(({ brawlhallaId, name }) => ({ brawlhallaId, name })),
      })

      const standings = await leaderboardRanked.applyLeaderboardRanked({
        observedAt: chunkObservedAt,
        players: chunk.map(({ name: _name, ...standing }) => standing),
      })

      changedNames += names.changed
      changedStandings += standings.changed
      changed('name', names.changed)
      changed('standing', standings.changed)
    } else if (chunk.length > 0 && mode === 'solo2v2' && leaderboardTeamModes) {
      // Solo 2v2 names are as cached as 2v2 ones; only the numbers are kept.
      const solo = await leaderboardTeamModes.applyLeaderboardSoloQueue({
        observedAt: chunkObservedAt,
        players: chunk.map(({ name: _name, ...standing }) => standing),
      })

      changedStandings += solo.changed
      changed('solo', solo.changed)
    } else if (teamChunk.length > 0 && leaderboardTeamModes) {
      const teams = await leaderboardTeamModes.applyLeaderboardTeams({ observedAt: chunkObservedAt, teams: teamChunk })

      changedStandings += teams.changed
      changed('team', teams.changed)
    }

    chunk = []
    teamChunk = []
    await progress?.save({ mode, region, windowAt, nextPage: page, totalPages })
  }

  const log = (outcome: 'completed' | 'yielded') =>
    record((active) =>
      active.logger.info(`leaderboard.deep_crawl.${outcome}`, {
        mode,
        region,
        nextPage: page,
        totalPages,
        pagesRead,
        pagesSkipped,
        changedNames,
        changedStandings,
        durationMs: Math.round(performance.now() - started),
      }),
    )

  while (page <= totalPages) {
    if (authorityLost.aborted) throw new LeaderboardLeaseLostError()

    if (chunk.length === 0 && teamChunk.length === 0) chunkObservedAt = new Date()

    let result: Awaited<ReturnType<LeaderboardPageSource['fetchPage']>>

    try {
      result = await fetchPage({ mode, region, page })
    } catch (error) {
      // Deep pages are never read by the regular collections: one bad page must not cost the whole region, and a
      // leaderboard that shrank while the crawl ran simply ends it. A failure on page 1 still fails the attempt.
      if (!(error instanceof LeaderboardSourceError) || error.code !== 'source_contract_invalid' || page === 1) {
        throw error
      }

      if (/exceeds total_pages/.test(error.message)) break

      pagesSkipped += 1

      record((active) =>
        active.metrics.add('leaderboard_deep_crawl_pages_total', 1, { mode, region, outcome: 'skipped' }),
      )

      page += 1
      continue
    }

    if (page === 1) totalPages = result.totalPages

    if (result.rankings.length === 0) break

    pagesRead += 1
    record((active) => active.metrics.add('leaderboard_deep_crawl_pages_total', 1, { mode, region, outcome: 'read' }))
    if (mode === '2v2') teamChunk.push(...leaderboardDeepCrawlTeams(result))
    else chunk.push(...leaderboardDeepCrawlStandings(result))

    page += 1
    if (options.deepCrawlPageDelayMs && page <= totalPages) {
      await (options.waitForSourceRetry ?? waitForRenewal)(options.deepCrawlPageDelayMs, authorityLost)
    }

    if (pagesRead % deepCrawlChunkPages === 0) {
      await flush()
      if (pagesRead >= slicePages && page <= totalPages) {
        log('yielded')
        throw new LeaderboardDeepCrawlYield()
      }
    }
  }

  page = totalPages + 1
  await flush()
  log('completed')

  return (await operations.complete(lease)) === 'lease-lost' ? 'lease_lost' : 'succeeded'
}

async function executeLeaderboard(
  operations: RefreshOperationWorker,
  lease: LeaderboardLease,
  options: RunOneRefreshOperationOptions,
  authorityLost: AbortSignal,
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
      fetchPage: admittedLeaderboardPageFetch(
        operations,
        lease,
        options,
        sourceAdmission,
        leaderboardSource,
        authorityLost,
      ),
    },
    publication: withLeaderboardNamePropagation(
      ranking,
      options.leaderboardPlayerNames,
      options.leaderboardRanked,
      options.telemetry,
    ),
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
  const telemetry = options.telemetry

  function record(recording: (active: Telemetry) => void): void {
    recordTelemetry(telemetry, recording)
  }

  const claimStarted = performance.now()
  const claimed = await operations.claim(workerId, options.leaseMs, options.admission)
  const claimDurationMs = performance.now() - claimStarted

  record((active) =>
    active.metrics.observe('operation_claim_duration_ms', claimDurationMs, { outcome: claimed ? 'claimed' : 'empty' }),
  )

  if (!claimed) return false

  const lease: OperationLease = claimed

  const started = performance.now()
  let attemptOutcome: AttemptExecutionOutcome = 'succeeded'
  let failureCategory: FailureCategory = 'unknown'

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
      } else if (lease.kind === 'player-name-verification') {
        attemptOutcome = await executeNameVerification(operations, lease, options)
      } else if (lease.kind === 'ranking-retention') {
        attemptOutcome = await executeRankingRetention(operations, lease, options)
      } else if (lease.kind === 'statistics-publication') {
        attemptOutcome = await executeStatisticsPublication(operations, lease, options)
      } else if (lease.kind === 'statistics-legend-meta-publication') {
        attemptOutcome = await executeStatisticsLegendMetaPublication(operations, lease, options)
      } else if (lease.workClass === 'global-statistics') {
        attemptOutcome = await executeStatisticsCollection(operations, lease, options)
      } else if (lease.kind === 'leaderboard-deep-crawl') {
        attemptOutcome = await executeLeaderboardDeepCrawl(operations, lease, options, authorityLost.signal)
      } else {
        attemptOutcome = await executeLeaderboard(operations, lease, options, authorityLost.signal)
      }

      if (attemptOutcome === 'lease_lost') failureCategory = 'lease_lost'
    } catch (error) {
      const decision = await decideJobFailure(lease, error, options)
      const settlement = await settleFailure(operations, lease, options, decision)

      attemptOutcome = settlement.outcome
      failureCategory = settlement.category

      if (decision.action === 'fail') {
        const failure = decision.failure

        record((active) =>
          active.logger.error('operation.attempt.failed', error, {
            operationId: lease.operationId,
            effectOperationId: lease.effectOperationId,
            attemptNumber: lease.attemptNumber,
            kind: lease.kind,
            workClass: lease.workClass,
            outcome: attemptOutcome,
            failureCategory,
            ...(safeFailureCode.test(failure.code) ? { failureCode: failure.code } : {}),
          }),
        )
      }

      return true
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
