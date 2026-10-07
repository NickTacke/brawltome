import type { FreshnessAttempt, RefreshRequestDemand } from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'
import { type SourceUsage, sourceBudgetOpen } from './player-name-verification'

const hourMs = 60 * 60 * 1000
const failedBackoffMs = 7 * 24 * hourMs
const viewRetentionDays = 30
const viewTrimIntervalMs = hourMs

// 'repeat' players were viewed on two or more days in the window and go first.
export type FreshnessTier = 'repeat' | 'single'

export type FreshnessPlannerConfig = {
  enabled: boolean
  maxUsageRatio: number
  batch: number
  intervalMs: number
  windowDays: number
  refreshIntervalMs: number
}

function boundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

export function readFreshnessPlannerConfig(env: NodeJS.ProcessEnv): FreshnessPlannerConfig {
  const enabled = env.FRESHNESS_PLANNER_ENABLED ?? 'true'
  if (enabled !== 'true' && enabled !== 'false') throw new Error('FRESHNESS_PLANNER_ENABLED must be true or false')
  const maxUsageRatio = env.FRESHNESS_V0_MAX_USAGE_RATIO === undefined ? 0.5 : Number(env.FRESHNESS_V0_MAX_USAGE_RATIO)
  if (!Number.isFinite(maxUsageRatio) || maxUsageRatio <= 0 || maxUsageRatio > 0.8) {
    throw new Error('FRESHNESS_V0_MAX_USAGE_RATIO must be in (0, 0.8]')
  }
  return {
    enabled: enabled === 'true',
    maxUsageRatio,
    batch: boundedInteger(env.FRESHNESS_BATCH, 4, 'FRESHNESS_BATCH', 1, 20),
    intervalMs: boundedInteger(env.FRESHNESS_INTERVAL_MS, 30_000, 'FRESHNESS_INTERVAL_MS', 5_000, 15 * 60 * 1000),
    windowDays: boundedInteger(env.FRESHNESS_WINDOW_DAYS, 14, 'FRESHNESS_WINDOW_DAYS', 1, viewRetentionDays),
    refreshIntervalMs: boundedInteger(env.FRESHNESS_REFRESH_HOURS, 12, 'FRESHNESS_REFRESH_HOURS', 1, 7 * 24) * hourMs,
  }
}

export type ViewDemand = { brawlhallaId: number; viewDays: number }

// Merges both demand signals per player: profile view days and on-request refresh days.
export function mergeViewDemand(...sources: ReadonlyArray<readonly ViewDemand[]>): ViewDemand[] {
  const merged = new Map<number, number>()
  for (const source of sources) {
    for (const { brawlhallaId, viewDays } of source) {
      merged.set(brawlhallaId, Math.max(merged.get(brawlhallaId) ?? 0, viewDays))
    }
  }
  return [...merged].map(([brawlhallaId, viewDays]) => ({ brawlhallaId, viewDays }))
}

// active: the player's leaderboard standing changed since their last full refresh, so their legend, team and career
// numbers have likely moved too.
export type DueRefresh = { brawlhallaId: number; tier: FreshnessTier; refreshedAt: Date | null; active: boolean }

// Players whose full profile is older than the refresh interval: repeat viewers first, then players who played ranked
// since their last refresh, then the oldest data.
// One planner attempt per interval and a week's rest after a dead letter keep a player whose V0 refresh keeps failing
// from holding the slots, spending the budget, or paging every interval.
export function dueRefreshes(input: {
  demand: readonly ViewDemand[]
  lastRefreshed: ReadonlyMap<number, Date | null>
  lastPlayed?: ReadonlyMap<number, Date>
  attempts: ReadonlyMap<number, Pick<FreshnessAttempt, 'lastPlannedAt' | 'lastFailedAt'>>
  refreshIntervalMs: number
  now: number
}): DueRefresh[] {
  const due: DueRefresh[] = []
  for (const { brawlhallaId, viewDays } of input.demand) {
    const refreshedAt = input.lastRefreshed.get(brawlhallaId) ?? null
    if (refreshedAt && input.now - refreshedAt.getTime() <= input.refreshIntervalMs) continue
    const attempt = input.attempts.get(brawlhallaId)
    if (attempt?.lastPlannedAt && input.now - attempt.lastPlannedAt.getTime() <= input.refreshIntervalMs) continue
    if (attempt?.lastFailedAt && input.now - attempt.lastFailedAt.getTime() <= failedBackoffMs) continue
    const lastPlayed = input.lastPlayed?.get(brawlhallaId)
    const active = lastPlayed !== undefined && (!refreshedAt || lastPlayed.getTime() > refreshedAt.getTime())
    due.push({ brawlhallaId, tier: viewDays >= 2 ? 'repeat' : 'single', refreshedAt, active })
  }
  return due.sort(
    (left, right) =>
      Number(left.tier === 'single') - Number(right.tier === 'single') ||
      Number(right.active) - Number(left.active) ||
      (left.refreshedAt?.getTime() ?? 0) - (right.refreshedAt?.getTime() ?? 0) ||
      left.brawlhallaId - right.brawlhallaId,
  )
}

export function createFreshnessPlanner(deps: {
  config: FreshnessPlannerConfig
  readSourceUsage: () => Promise<SourceUsage>
  operations: {
    refreshRequestDemand(input: { windowDays: number }): Promise<RefreshRequestDemand[]>
    recentFreshnessAttempts(input: { windowDays: number }): Promise<FreshnessAttempt[]>
    activeRecentlyViewedRefreshes(): Promise<number>
    enqueueRecentlyViewedRefreshes(brawlhallaIds: readonly number[]): Promise<number[]>
  }
  profileViews: {
    viewDemand(input: { days: number }): Promise<ViewDemand[]>
    trim(input: { keepDays: number }): Promise<number>
  }
  freshness: {
    lastRefreshedById(brawlhallaIds: readonly number[]): Promise<Map<number, Date | null>>
    lastPlayedById?(brawlhallaIds: readonly number[]): Promise<Map<number, Date>>
  }
  telemetry?: Telemetry
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  let nextRunAt = 0
  let nextTrimAt = 0
  const record = (write: (active: Telemetry) => void) => {
    if (!deps.telemetry) return
    try {
      write(deps.telemetry)
    } catch {
      return
    }
  }

  async function plan(): Promise<number> {
    if (now() >= nextTrimAt) {
      nextTrimAt = now() + viewTrimIntervalMs
      await deps.profileViews.trim({ keepDays: viewRetentionDays })
    }
    const usage = await deps.readSourceUsage()
    if (!sourceBudgetOpen(usage, deps.config.maxUsageRatio)) {
      record((active) => active.metrics.add('freshness_planner_skips_total', 1, { reason: 'budget' }))
      return 0
    }
    // Few in flight at a time keeps V0 calls spread out and the monitoring queue short; a visitor arriving while one
    // is still queued promotes it to interactive work (reserveInteractivePlayerRefresh).
    const slots = deps.config.batch - (await deps.operations.activeRecentlyViewedRefreshes())
    if (slots <= 0) {
      record((active) => active.metrics.add('freshness_planner_skips_total', 1, { reason: 'slots' }))
      return 0
    }
    const window = { windowDays: deps.config.windowDays }
    const [views, requests, attempts] = await Promise.all([
      deps.profileViews.viewDemand({ days: deps.config.windowDays }),
      deps.operations.refreshRequestDemand(window),
      deps.operations.recentFreshnessAttempts(window),
    ])
    const demand = mergeViewDemand(views, requests)
    const ids = demand.map(({ brawlhallaId }) => brawlhallaId)
    const [lastRefreshed, lastPlayed] = await Promise.all([
      deps.freshness.lastRefreshedById(ids),
      deps.freshness.lastPlayedById?.(ids),
    ])
    const due = dueRefreshes({
      demand,
      lastRefreshed,
      lastPlayed,
      attempts: new Map(attempts.map((attempt) => [attempt.brawlhallaId, attempt])),
      refreshIntervalMs: deps.config.refreshIntervalMs,
      now: now(),
    })
    record((active) => {
      for (const tier of ['repeat', 'single'] as const) {
        active.metrics.set('freshness_due_players', due.filter((entry) => entry.tier === tier).length, { tier })
      }
    })
    const selected = due.slice(0, slots)
    if (selected.length === 0) return 0
    const enqueued = new Set(
      await deps.operations.enqueueRecentlyViewedRefreshes(selected.map(({ brawlhallaId }) => brawlhallaId)),
    )
    record((active) => {
      for (const { brawlhallaId, tier } of selected) {
        active.metrics.add('freshness_refreshes_total', 1, {
          tier,
          outcome: enqueued.has(brawlhallaId) ? 'enqueued' : 'already_active',
        })
      }
      active.logger.info('freshness_planner.planned', {
        demand: demand.length,
        due: due.length,
        dueActive: due.filter((entry) => entry.active).length,
        enqueued: enqueued.size,
        sourceUsed: usage.used,
      })
    })
    return enqueued.size
  }

  return {
    // Never throws: a failed plan only delays background refreshes to the next interval.
    async tick(): Promise<number> {
      if (!deps.config.enabled || now() < nextRunAt) return 0
      nextRunAt = now() + deps.config.intervalMs
      try {
        return await plan()
      } catch (error) {
        record((active) => active.logger.error('freshness_planner.plan_failed', error))
        return 0
      }
    },
  }
}
