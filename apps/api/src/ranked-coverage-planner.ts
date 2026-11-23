import { parseBoundedInteger } from '@brawltome/foundation'
import {
  type DueCoverageRefresh,
  dueCoverageRefreshes,
  type FreshnessAttempt,
  type RankedCoverageCandidate,
  rankedCoverageBands,
  rankedCoverageMinimumRating,
  rankedCoveragePolicy,
  summarizeCoverage,
} from '@brawltome/player'
import type { Telemetry } from '@brawltome/telemetry'
import { type SourceUsage, sourceBudgetOpen } from './player-name-verification'

const dayMs = 24 * 60 * 60 * 1000
// how long one read of the boards is worked through before the next; each pick is re-checked against the database
const candidateReloadIntervalMs = 5 * 60 * 1000
// how soon a pass that found the source busy looks again, so a short wait doesn't cost a whole spacing interval
const busyRecheckMs = 2_000

// the planner's attempt history has to reach back over the longest interval and the dead-letter rest
const attemptHistoryDays = Math.ceil(
  Math.max(
    rankedCoveragePolicy.failedBackoffMs,
    ...rankedCoveragePolicy.bands.map(({ refreshIntervalMs }) => refreshIntervalMs),
  ) / dayMs,
)

export type RankedCoveragePlannerConfig = {
  // off: the planner only reports coverage, it requests no refreshes
  enabled: boolean
  // one coverage refresh is one V0 call, so this is the time between calls
  callSpacingMs: number
  maxUsageRatio: number
}

type SkipReason = 'source_paused' | 'budget' | 'interactive' | 'slot_busy' | 'nothing_due'

export function readRankedCoveragePlannerConfig(env: NodeJS.ProcessEnv): RankedCoveragePlannerConfig {
  // off unless set: the release that teaches the worker this refresh has to ship before anything requests one
  const enabled = env.RANKED_COVERAGE_ENABLED ?? 'false'

  if (enabled !== 'true' && enabled !== 'false') throw new Error('RANKED_COVERAGE_ENABLED must be true or false')

  const maxUsageRatio =
    env.RANKED_COVERAGE_V0_MAX_USAGE_RATIO === undefined ? 0.5 : Number(env.RANKED_COVERAGE_V0_MAX_USAGE_RATIO)

  if (!Number.isFinite(maxUsageRatio) || maxUsageRatio <= 0 || maxUsageRatio > 0.8) {
    throw new Error('RANKED_COVERAGE_V0_MAX_USAGE_RATIO must be in (0, 0.8]')
  }

  const callSpacingMs = parseBoundedInteger(env.RANKED_COVERAGE_CALL_SPACING_MS, {
    name: 'RANKED_COVERAGE_CALL_SPACING_MS',
    fallback: 15_000,
    minimum: 5_000,
    maximum: 10 * 60 * 1000,
  })

  return { enabled: enabled === 'true', callSpacingMs, maxUsageRatio }
}

export type RankedCoveragePlannerDependencies = {
  config: RankedCoveragePlannerConfig
  readSourceUsage: () => Promise<SourceUsage>
  readSourcePausedUntil: () => Promise<Date | null>
  coverage: {
    candidates(input: { minimumRating: number; playedRankedSince: Date }): Promise<RankedCoverageCandidate[]>
    lastRankedSuccess(brawlhallaId: number): Promise<Date | null>
  }
  operations: {
    activeBackgroundPlayerRefreshes(): Promise<number>
    activeInteractivePlayerRefreshes(): Promise<number>
    enqueueRankedCoverageRefresh(brawlhallaId: number): Promise<boolean>
    recentRankedCoverageAttempts(input: { windowDays: number }): Promise<FreshnessAttempt[]>
  }
  telemetry?: Telemetry
  now?: () => number
}

type Wait = { reason: SkipReason; untilMs: number }

/**
 * Keeps the ranked profiles of high-rated 1v1 players fresh, one ranked-only V0 refresh at a time and at most one
 * per call spacing. It waits whenever the V0 source is paused, the budget is past its share, a visitor's refresh is
 * in flight or another background player refresh still holds the slot.
 */
export function createRankedCoveragePlanner(deps: RankedCoveragePlannerDependencies) {
  const now = deps.now ?? Date.now
  let due: DueCoverageRefresh[] = []
  let nextReloadAt = 0
  let nextRunAt = 0

  const record = (write: (active: Telemetry) => void) => {
    if (!deps.telemetry) return

    try {
      write(deps.telemetry)
    } catch {
      return
    }
  }

  async function readCoverage(): Promise<void> {
    const readAt = now()

    const [candidates, attempts] = await Promise.all([
      deps.coverage.candidates({
        minimumRating: rankedCoverageMinimumRating,
        playedRankedSince: new Date(readAt - rankedCoveragePolicy.playedRankedWithinMs),
      }),
      deps.operations.recentRankedCoverageAttempts({ windowDays: attemptHistoryDays }),
    ])

    due = dueCoverageRefreshes({
      candidates,
      attempts: new Map(attempts.map((attempt) => [attempt.brawlhallaId, attempt])),
      now: readAt,
    })

    record((active) => {
      for (const { band, age, players } of summarizeCoverage(candidates, readAt)) {
        active.metrics.set('ranked_coverage_players', players, { band, age })
      }

      for (const band of rankedCoverageBands) {
        active.metrics.set('ranked_coverage_due_players', due.filter((entry) => entry.band === band).length, { band })
      }

      active.logger.info('ranked_coverage.read', { candidates: candidates.length, due: due.length })
    })
  }

  // a failed read leaves the reload due, so the next pass tries again
  async function reloadWhenDue(): Promise<void> {
    if (now() < nextReloadAt) return

    if (deps.telemetry) {
      await deps.telemetry.trace('ranked_coverage.read', { minimumRating: rankedCoverageMinimumRating }, readCoverage)
    } else {
      await readCoverage()
    }

    nextReloadAt = now() + candidateReloadIntervalMs
  }

  // the cheapest checks first; each one that holds the planner back says until when
  async function findWait(): Promise<Wait | null> {
    const pausedUntil = await deps.readSourcePausedUntil()

    if (pausedUntil) return { reason: 'source_paused', untilMs: pausedUntil.getTime() }

    const busyUntilMs = now() + busyRecheckMs
    const interactiveRefreshes = await deps.operations.activeInteractivePlayerRefreshes()

    if (interactiveRefreshes > 0) return { reason: 'interactive', untilMs: busyUntilMs }

    const backgroundRefreshes = await deps.operations.activeBackgroundPlayerRefreshes()

    if (backgroundRefreshes > 0) return { reason: 'slot_busy', untilMs: busyUntilMs }

    // last: it reads every reservation in the 15-minute window, where the counts above use indexes
    const usage = await deps.readSourceUsage()

    if (!sourceBudgetOpen(usage, deps.config.maxUsageRatio)) return { reason: 'budget', untilMs: busyUntilMs }

    return null
  }

  // the list is minutes old, so a player someone refreshed since then is dropped instead of refreshed twice
  async function takeNextDue(): Promise<DueCoverageRefresh | null> {
    for (let next = due.shift(); next; next = due.shift()) {
      const lastSuccess = await deps.coverage.lastRankedSuccess(next.brawlhallaId)
      const isRefreshedSinceRead = lastSuccess !== null && lastSuccess.getTime() !== next.lastSuccessAt?.getTime()

      if (!isRefreshedSinceRead) return next
    }

    return null
  }

  async function enqueue(next: DueCoverageRefresh): Promise<number> {
    const isEnqueued = await deps.operations.enqueueRankedCoverageRefresh(next.brawlhallaId)
    const outcome = isEnqueued ? 'enqueued' : 'already_active'

    record((active) => active.metrics.add('ranked_coverage_refreshes_total', 1, { band: next.band, outcome }))

    // a player someone else is refreshing costs no call, so the next one may follow without the spacing
    nextRunAt = isEnqueued ? now() + deps.config.callSpacingMs : now() + busyRecheckMs

    return isEnqueued ? 1 : 0
  }

  function skip(wait: Wait): number {
    nextRunAt = wait.untilMs
    record((active) => active.metrics.add('ranked_coverage_skips_total', 1, { reason: wait.reason }))

    return 0
  }

  async function plan(): Promise<number> {
    await reloadWhenDue()

    if (!deps.config.enabled) {
      nextRunAt = nextReloadAt

      return 0
    }

    const wait = await findWait()

    if (wait) return skip(wait)

    const next = await takeNextDue()

    if (!next) return skip({ reason: 'nothing_due', untilMs: nextReloadAt })

    return enqueue(next)
  }

  return {
    // Never throws: a failed pass only delays coverage to the next look.
    async tick(): Promise<number> {
      if (now() < nextRunAt) return 0

      try {
        return await plan()
      } catch (error) {
        // while off the planner only reads coverage, so a failing read waits as long as a good one would
        const retryMs = deps.config.enabled ? deps.config.callSpacingMs : candidateReloadIntervalMs

        nextRunAt = now() + retryMs
        record((active) => active.logger.error('ranked_coverage.plan_failed', error))

        return 0
      }
    },
  }
}
