import type { RecentlyViewedPlayer } from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'
import { type SourceUsage, sourceBudgetOpen } from './player-name-verification'

const hourMs = 60 * 60 * 1000

export type FreshnessTier = 'hot' | 'warm' | 'cold'

export type FreshnessPlannerConfig = {
  enabled: boolean
  maxUsageRatio: number
  batch: number
  intervalMs: number
  windowDays: number
  hotDays: number
  tierIntervalsMs: Record<FreshnessTier, number>
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
    windowDays: 30,
    hotDays: 7,
    tierIntervalsMs: { hot: 4 * hourMs, warm: 12 * hourMs, cold: 24 * hourMs },
  }
}

export function freshnessTier(player: Pick<RecentlyViewedPlayer, 'recentViews'>): FreshnessTier {
  if (player.recentViews >= 3) return 'hot'
  if (player.recentViews >= 1) return 'warm'
  return 'cold'
}

const tierRank: Record<FreshnessTier, number> = { hot: 0, warm: 1, cold: 2 }

export type DueRefresh = { brawlhallaId: number; tier: FreshnessTier; refreshedAt: Date | null }

// Due players, hottest tier first and then the oldest data (never refreshed first).
export function dueRefreshes(input: {
  candidates: readonly RecentlyViewedPlayer[]
  lastRefreshed: ReadonlyMap<number, Date | null>
  tierIntervalsMs: Record<FreshnessTier, number>
  now: number
}): DueRefresh[] {
  const due: DueRefresh[] = []
  for (const candidate of input.candidates) {
    const tier = freshnessTier(candidate)
    const refreshedAt = input.lastRefreshed.get(candidate.brawlhallaId) ?? null
    if (refreshedAt && input.now - refreshedAt.getTime() <= input.tierIntervalsMs[tier]) continue
    due.push({ brawlhallaId: candidate.brawlhallaId, tier, refreshedAt })
  }
  return due.sort(
    (left, right) =>
      tierRank[left.tier] - tierRank[right.tier] ||
      (left.refreshedAt?.getTime() ?? 0) - (right.refreshedAt?.getTime() ?? 0) ||
      left.brawlhallaId - right.brawlhallaId,
  )
}

export function createFreshnessPlanner(deps: {
  config: FreshnessPlannerConfig
  readSourceUsage: () => Promise<SourceUsage>
  operations: {
    recentlyViewedPlayers(input: { windowDays: number; hotDays: number }): Promise<RecentlyViewedPlayer[]>
    activeRecentlyViewedRefreshes(): Promise<number>
    enqueueRecentlyViewedRefreshes(brawlhallaIds: readonly number[]): Promise<number[]>
  }
  freshness: { lastRefreshedById(brawlhallaIds: readonly number[]): Promise<Map<number, Date | null>> }
  telemetry?: Telemetry
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  let nextRunAt = 0
  const record = (write: (active: Telemetry) => void) => {
    if (!deps.telemetry) return
    try {
      write(deps.telemetry)
    } catch {
      return
    }
  }

  async function plan(): Promise<number> {
    const usage = await deps.readSourceUsage()
    if (!sourceBudgetOpen(usage, deps.config.maxUsageRatio)) {
      record((active) => active.metrics.add('freshness_planner_skips_total', 1, { reason: 'budget' }))
      return 0
    }
    // A few in flight at a time: a visitor whose player is mid-refresh waits behind at most this many.
    const slots = deps.config.batch - (await deps.operations.activeRecentlyViewedRefreshes())
    if (slots <= 0) {
      record((active) => active.metrics.add('freshness_planner_skips_total', 1, { reason: 'slots' }))
      return 0
    }
    const candidates = await deps.operations.recentlyViewedPlayers({
      windowDays: deps.config.windowDays,
      hotDays: deps.config.hotDays,
    })
    const due = dueRefreshes({
      candidates,
      lastRefreshed: await deps.freshness.lastRefreshedById(candidates.map(({ brawlhallaId }) => brawlhallaId)),
      tierIntervalsMs: deps.config.tierIntervalsMs,
      now: now(),
    })
    record((active) => {
      for (const tier of ['hot', 'warm', 'cold'] as const) {
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
        due: due.length,
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
