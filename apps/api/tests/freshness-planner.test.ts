import { describe, expect, test } from 'bun:test'
import type { RecentlyViewedPlayer } from '@brawltome/refresh-operations'
import {
  createFreshnessPlanner,
  dueRefreshes,
  freshnessTier,
  readFreshnessPlannerConfig,
} from '../src/freshness-planner'

const hour = 60 * 60 * 1000
const now = Date.parse('2026-10-07T12:00:00Z')
const config = readFreshnessPlannerConfig({})

describe('freshness planner', () => {
  test('reads bounded defaults and switches', () => {
    expect(config).toMatchObject({ enabled: true, maxUsageRatio: 0.5, batch: 4, intervalMs: 30_000 })
    expect(config.tierIntervalsMs).toEqual({ hot: 4 * hour, warm: 12 * hour, cold: 24 * hour })
    expect(readFreshnessPlannerConfig({ FRESHNESS_PLANNER_ENABLED: 'false' }).enabled).toBe(false)
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_PLANNER_ENABLED: 'yes' })).toThrow('FRESHNESS_PLANNER_ENABLED')
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_V0_MAX_USAGE_RATIO: '0.9' })).toThrow(
      'FRESHNESS_V0_MAX_USAGE_RATIO',
    )
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_BATCH: '0' })).toThrow('FRESHNESS_BATCH')
  })

  test('tiers players by recent views', () => {
    expect(freshnessTier({ recentViews: 3 })).toBe('hot')
    expect(freshnessTier({ recentViews: 1 })).toBe('warm')
    expect(freshnessTier({ recentViews: 0 })).toBe('cold')
  })

  test('keeps only players older than their tier interval, hottest and oldest first', () => {
    const candidates: RecentlyViewedPlayer[] = [
      { brawlhallaId: 1, recentViews: 5, views: 5 },
      { brawlhallaId: 2, recentViews: 5, views: 5 },
      { brawlhallaId: 3, recentViews: 1, views: 1 },
      { brawlhallaId: 4, recentViews: 0, views: 2 },
      { brawlhallaId: 5, recentViews: 0, views: 1 },
      { brawlhallaId: 6, recentViews: 1, views: 1 },
    ]
    const lastRefreshed = new Map<number, Date | null>([
      [1, new Date(now - 5 * hour)],
      [2, null],
      [3, new Date(now - 13 * hour)],
      [4, new Date(now - 23 * hour)],
      [5, new Date(now - 30 * hour)],
      [6, new Date(now - 2 * hour)],
    ])
    expect(
      dueRefreshes({ candidates, lastRefreshed, tierIntervalsMs: config.tierIntervalsMs, now }).map(
        ({ brawlhallaId, tier }) => [brawlhallaId, tier],
      ),
    ).toEqual([
      [2, 'hot'],
      [1, 'hot'],
      [3, 'warm'],
      [5, 'cold'],
    ])
  })

  const planner = (overrides: {
    used?: number
    active?: number
    enabled?: boolean
    enqueue?: (ids: readonly number[]) => Promise<number[]>
  }) => {
    const enqueued: number[][] = []
    const instance = createFreshnessPlanner({
      config: { ...config, enabled: overrides.enabled ?? true },
      readSourceUsage: async () => ({ used: overrides.used ?? 10, limit: 180 }),
      operations: {
        recentlyViewedPlayers: async () =>
          [1, 2, 3, 4, 5, 6].map((id) => ({ brawlhallaId: id, recentViews: 3, views: 3 })),
        activeRecentlyViewedRefreshes: async () => overrides.active ?? 0,
        enqueueRecentlyViewedRefreshes:
          overrides.enqueue ??
          (async (ids) => {
            enqueued.push([...ids])
            return [...ids]
          }),
      },
      freshness: { lastRefreshedById: async (ids) => new Map(ids.map((id) => [id, null])) },
      now: () => now,
    })
    return { instance, enqueued }
  }

  test('fills the free slots while the V0 budget is open', async () => {
    const { instance, enqueued } = planner({ active: 1 })
    expect(await instance.tick()).toBe(3)
    expect(enqueued).toEqual([[1, 2, 3]])
    // Throttled until the next interval.
    expect(await instance.tick()).toBe(0)
  })

  test('enqueues nothing when the budget is closed, slots are full, or it is disabled', async () => {
    expect(await planner({ used: 90 }).instance.tick()).toBe(0)
    expect(await planner({ active: 4 }).instance.tick()).toBe(0)
    expect(await planner({ enabled: false }).instance.tick()).toBe(0)
  })

  test('never throws from a failed plan', async () => {
    const { instance } = planner({
      enqueue: async () => {
        throw new Error('database unavailable')
      },
    })
    expect(await instance.tick()).toBe(0)
  })
})
