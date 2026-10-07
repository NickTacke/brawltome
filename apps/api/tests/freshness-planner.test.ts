import { describe, expect, test } from 'bun:test'
import {
  createFreshnessPlanner,
  dueRefreshes,
  mergeViewDemand,
  readFreshnessPlannerConfig,
} from '../src/freshness-planner'

const hour = 60 * 60 * 1000
const now = Date.parse('2026-10-07T12:00:00Z')
const config = readFreshnessPlannerConfig({})

describe('freshness planner', () => {
  test('reads bounded defaults and switches', () => {
    expect(config).toMatchObject({
      enabled: true,
      maxUsageRatio: 0.5,
      batch: 4,
      intervalMs: 30_000,
      windowDays: 14,
      refreshIntervalMs: 12 * hour,
    })
    expect(readFreshnessPlannerConfig({ FRESHNESS_PLANNER_ENABLED: 'false' }).enabled).toBe(false)
    expect(readFreshnessPlannerConfig({ FRESHNESS_REFRESH_HOURS: '24' }).refreshIntervalMs).toBe(24 * hour)
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_PLANNER_ENABLED: 'yes' })).toThrow('FRESHNESS_PLANNER_ENABLED')
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_V0_MAX_USAGE_RATIO: '0.9' })).toThrow(
      'FRESHNESS_V0_MAX_USAGE_RATIO',
    )
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_WINDOW_DAYS: '31' })).toThrow('FRESHNESS_WINDOW_DAYS')
    expect(() => readFreshnessPlannerConfig({ FRESHNESS_BATCH: '0' })).toThrow('FRESHNESS_BATCH')
  })

  test('merges profile views and refresh requests by the larger day count', () => {
    expect(
      mergeViewDemand(
        [
          { brawlhallaId: 1, viewDays: 3 },
          { brawlhallaId: 2, viewDays: 1 },
        ],
        [
          { brawlhallaId: 2, viewDays: 2 },
          { brawlhallaId: 3, viewDays: 1 },
        ],
      ).sort((left, right) => left.brawlhallaId - right.brawlhallaId),
    ).toEqual([
      { brawlhallaId: 1, viewDays: 3 },
      { brawlhallaId: 2, viewDays: 2 },
      { brawlhallaId: 3, viewDays: 1 },
    ])
  })

  test('keeps profiles older than the interval, repeat viewers first and then the oldest data', () => {
    const lastRefreshed = new Map<number, Date | null>([
      [1, new Date(now - 13 * hour)],
      [2, null],
      [3, new Date(now - 20 * hour)],
      [4, new Date(now - 30 * hour)],
      [5, new Date(now - 2 * hour)],
    ])
    expect(
      dueRefreshes({
        demand: [
          { brawlhallaId: 1, viewDays: 2 },
          { brawlhallaId: 2, viewDays: 1 },
          { brawlhallaId: 3, viewDays: 4 },
          { brawlhallaId: 4, viewDays: 1 },
          { brawlhallaId: 5, viewDays: 5 },
        ],
        lastRefreshed,
        attempts: new Map(),
        refreshIntervalMs: config.refreshIntervalMs,
        now,
      }).map(({ brawlhallaId, tier }) => [brawlhallaId, tier]),
    ).toEqual([
      [3, 'repeat'],
      [1, 'repeat'],
      [2, 'single'],
      [4, 'single'],
    ])
  })

  test('backs off players the planner recently tried, and for a week after a dead letter', () => {
    const demand = [1, 2, 3, 4].map((brawlhallaId) => ({ brawlhallaId, viewDays: 2 }))
    const attempts = new Map([
      [1, { lastPlannedAt: new Date(now - 3 * hour), lastFailedAt: null }],
      [2, { lastPlannedAt: new Date(now - 13 * hour), lastFailedAt: null }],
      [3, { lastPlannedAt: new Date(now - 5 * 24 * hour), lastFailedAt: new Date(now - 6 * 24 * hour) }],
      [4, { lastPlannedAt: new Date(now - 8 * 24 * hour), lastFailedAt: new Date(now - 8 * 24 * hour) }],
    ])
    expect(
      dueRefreshes({
        demand,
        lastRefreshed: new Map(demand.map(({ brawlhallaId }) => [brawlhallaId, null])),
        attempts,
        refreshIntervalMs: config.refreshIntervalMs,
        now,
      }).map(({ brawlhallaId }) => brawlhallaId),
    ).toEqual([2, 4])
  })

  const planner = (overrides: {
    used?: number
    active?: number
    enabled?: boolean
    enqueue?: (ids: readonly number[]) => Promise<number[]>
  }) => {
    const enqueued: number[][] = []
    let trims = 0
    const instance = createFreshnessPlanner({
      config: { ...config, enabled: overrides.enabled ?? true },
      readSourceUsage: async () => ({ used: overrides.used ?? 10, limit: 180 }),
      operations: {
        refreshRequestDemand: async () => [5, 6].map((brawlhallaId) => ({ brawlhallaId, viewDays: 1 })),
        recentFreshnessAttempts: async () => [],
        activeRecentlyViewedRefreshes: async () => overrides.active ?? 0,
        enqueueRecentlyViewedRefreshes:
          overrides.enqueue ??
          (async (ids) => {
            enqueued.push([...ids])
            return [...ids]
          }),
      },
      profileViews: {
        viewDemand: async () => [1, 2, 3, 4].map((brawlhallaId) => ({ brawlhallaId, viewDays: 3 })),
        trim: async () => {
          trims++
          return 0
        },
      },
      freshness: { lastRefreshedById: async (ids) => new Map(ids.map((id) => [id, null])) },
      now: () => now,
    })
    return { instance, enqueued, trims: () => trims }
  }

  test('fills the free slots from both demand sources while the V0 budget is open', async () => {
    const { instance, enqueued, trims } = planner({ active: 1 })
    expect(await instance.tick()).toBe(3)
    expect(enqueued).toEqual([[1, 2, 3]])
    expect(trims()).toBe(1)
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
