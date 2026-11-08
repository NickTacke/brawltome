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
} from '@brawltome/ranking'
import {
  type AdmissionConfig,
  type AttemptOutcome,
  createJobRegistry,
  defineJob,
  type FailureDecision,
  failureDetails,
  type JobDefinition,
  type JobTools,
  type LeaseOperations,
  leaderboardOperationKinds,
  type OperationLease,
  type RefreshOperationWorker,
  type RetryBackoff,
  type RetryTimings,
  runOneJob,
  SourceAdmissionLimitedError,
  sourceWaitMs,
  statisticsCollectionKinds,
  type WorkClass,
  waitForRenewal,
} from '@brawltome/refresh-operations'
import type { ActorAdmission, SourceAdmission } from '@brawltome/request-admission'
import type { LifetimeEvidence, RankedEvidence, StatisticsTracer } from '@brawltome/statistics'
import { observeSourceCall, type Telemetry } from '@brawltome/telemetry'

type LeaderboardDeepCrawlLease = Extract<OperationLease, { kind: 'leaderboard-deep-crawl' }>
type LeaderboardLease = Exclude<Extract<OperationLease, { workClass: 'leaderboard' }>, LeaderboardDeepCrawlLease>
type StatisticsLease = Extract<OperationLease, { workClass: 'global-statistics' }>
type StatisticsCollectionLease = Extract<
  StatisticsLease,
  { kind: 'statistics-ranked-collection' | 'statistics-lifetime-collection' }
>
type StatisticsPublicationLease = Extract<StatisticsLease, { kind: 'statistics-publication' }>
type StatisticsLegendMetaPublicationLease = Extract<StatisticsLease, { kind: 'statistics-legend-meta-publication' }>

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
  ranking?: RankingPublicationStore
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
  telemetry?: Telemetry
  // jobs that live in their owning module, added to the wrapped ones
  movedJobs?: readonly JobDefinition<unknown>[]
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

async function executeStatisticsCollection(
  operations: LeaseOperations,
  lease: StatisticsCollectionLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptOutcome> {
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
  operations: LeaseOperations,
  lease: StatisticsPublicationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptOutcome> {
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
  operations: LeaseOperations,
  lease: StatisticsLegendMetaPublicationLease,
  options: RunOneRefreshOperationOptions,
): Promise<AttemptOutcome> {
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
  operations: LeaseOperations,
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
  operations: LeaseOperations,
  lease: LeaderboardDeepCrawlLease,
  options: RunOneRefreshOperationOptions,
  authorityLost: AbortSignal,
): Promise<AttemptOutcome> {
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
  operations: LeaseOperations,
  lease: LeaderboardLease,
  options: RunOneRefreshOperationOptions,
  authorityLost: AbortSignal,
): Promise<AttemptOutcome> {
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

function retryTimings(options: RunOneRefreshOperationOptions): RetryTimings {
  return {
    retryDelayMs: options.retryDelayMs,
    sourceUnavailableRetryMs: options.sourceUnavailableRetryMs ?? 60_000,
  }
}

type WrappedJob<WrappedLease extends OperationLease> = {
  kind: WrappedLease['kind']
  workClasses: readonly WorkClass[]
  failureCode: string
  run(lease: WrappedLease, tools: JobTools): Promise<AttemptOutcome>
  decideFailure?(error: unknown, lease: WrappedLease): Promise<FailureDecision | null>
}

// claim already shapes these payloads, so wrapped jobs pass them through until each job moves to its owner
function wrapJob<WrappedLease extends OperationLease>(job: WrappedJob<WrappedLease>): JobDefinition<unknown> {
  const { decideFailure } = job

  return defineJob<unknown>({
    kind: job.kind,
    workClasses: job.workClasses,
    failureCode: job.failureCode,
    parsePayload: (value) => value,
    run: (lease, tools) => job.run(lease as WrappedLease, tools),
    decideFailure: decideFailure && ((error, lease) => decideFailure(error, lease as WrappedLease)),
  })
}

function statisticsJobs(options: RunOneRefreshOperationOptions): JobDefinition<unknown>[] {
  const collectionJobs = statisticsCollectionKinds.map((kind) =>
    wrapJob<StatisticsCollectionLease>({
      kind,
      workClasses: ['global-statistics'],
      failureCode: 'statistics_collection_failed',
      run: (lease, tools) => executeStatisticsCollection(tools.queue, lease, options),
    }),
  )

  return [
    ...collectionJobs,
    wrapJob<StatisticsPublicationLease>({
      kind: 'statistics-publication',
      workClasses: ['global-statistics'],
      failureCode: 'statistics_publication_failed',
      run: (lease, tools) => executeStatisticsPublication(tools.queue, lease, options),
    }),
    wrapJob<StatisticsLegendMetaPublicationLease>({
      kind: 'statistics-legend-meta-publication',
      workClasses: ['global-statistics'],
      failureCode: 'statistics_legend_meta_publication_failed',
      run: (lease, tools) => executeStatisticsLegendMetaPublication(tools.queue, lease, options),
    }),
  ]
}

function leaderboardJobs(options: RunOneRefreshOperationOptions): JobDefinition<unknown>[] {
  const decideFailure = async (error: unknown) => decideRankingFailure(error, retryTimings(options))

  const collectionJobs = leaderboardOperationKinds.map((kind) =>
    wrapJob<LeaderboardLease>({
      kind,
      workClasses: ['leaderboard'],
      failureCode: 'leaderboard_collection_failed',
      decideFailure,
      run: (lease, tools) => executeLeaderboard(tools.queue, lease, options, tools.signal),
    }),
  )

  return [
    ...collectionJobs,
    wrapJob<LeaderboardDeepCrawlLease>({
      kind: 'leaderboard-deep-crawl',
      workClasses: ['leaderboard'],
      failureCode: 'leaderboard_deep_crawl_failed',
      decideFailure,
      run: (lease, tools) => executeLeaderboardDeepCrawl(tools.queue, lease, options, tools.signal),
    }),
  ]
}

export function createJobsFromOptions(options: RunOneRefreshOperationOptions): JobDefinition<unknown>[] {
  return [...statisticsJobs(options), ...leaderboardJobs(options), ...(options.movedJobs ?? [])]
}

export function runOneRefreshOperation(
  operations: RefreshOperationWorker,
  workerId: string,
  options: RunOneRefreshOperationOptions,
): Promise<boolean> {
  return runOneJob(operations, workerId, createJobRegistry(createJobsFromOptions(options)), options)
}
