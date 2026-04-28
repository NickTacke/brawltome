import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BhApiClient, BhApiRanking1v1, Region } from '@brawltome/bhapi'
import type { PlayerRepo } from '@brawltome/player'
import type { MetricsRegistry } from '@brawltome/shared'
import Redis from 'ioredis'
import { type LockState, drainResyncQueue, sync1v1Page } from '../commands/sync-rankings'

let redis: Redis

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
})

afterAll(async () => {
  const cursorKeys = await redis.keys('cursor:test:*')
  if (cursorKeys.length > 0) await redis.del(...cursorKeys)
  await redis.quit()
})

function makeFakeBhapi(rankings: BhApiRanking1v1[]): BhApiClient {
  return {
    remainingTokens: () => 1000,
    async getRankings1v1() {
      return rankings
    },
    async getRankings2v2() {
      return []
    },
  } as unknown as BhApiClient
}

function makeFakeRepo(opts: { upsertThrows?: boolean } = {}): PlayerRepo {
  return {
    async getExistingPlayerNames() {
      return new Map<number, string>()
    },
    async batchInsertAliases() {},
    async batchUpsertPlayers() {
      if (opts.upsertThrows) throw new Error('forced db failure')
    },
    async batchUpsertPlaceholderPlayers() {},
    async batchUpsertTeams() {},
  } as unknown as PlayerRepo
}

const SAMPLE: BhApiRanking1v1 = {
  rank: 1,
  brawlhalla_id: 1,
  name: 'p',
  rating: 1000,
  peak_rating: 1000,
  tier: 'Bronze 1',
  games: 0,
  wins: 0,
  region: 'us-e',
  best_legend: 0,
  best_legend_games: 0,
  best_legend_wins: 0,
}

const NULL_METRICS: MetricsRegistry = {
  incrementQueue: async () => {},
  snapshotQueue: async () => ({}),
  snapshotAllQueues: async () => ({}),
  setScalar: async () => {},
  getScalar: async () => null,
  incrementCounter: async () => {},
  snapshotCounters: async () => ({}),
}

function makeSpyMetrics(): { metrics: MetricsRegistry; calls: string[] } {
  const calls: string[] = []
  const metrics: MetricsRegistry = {
    incrementQueue: async () => {},
    snapshotQueue: async () => ({}),
    snapshotAllQueues: async () => ({}),
    setScalar: async () => {},
    getScalar: async () => null,
    incrementCounter: async (key: string) => {
      calls.push(key)
    },
    snapshotCounters: async () => ({}),
  }
  return { metrics, calls }
}

describe('sync1v1Page', () => {
  it('does not advance cursor when batchUpsertPlayers throws', async () => {
    const cursorKey = `cursor:test:save-fail:${Date.now()}`
    await redis.set(cursorKey, '5')
    const lockState: LockState = { lost: false, value: 'test-lock' }
    const { metrics, calls } = makeSpyMetrics()

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([SAMPLE]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics,
    }

    await expect(
      sync1v1Page(deps, makeFakeRepo({ upsertThrows: true }), 'all', 1, 10, cursorKey, lockState),
    ).rejects.toThrow(/forced db failure/)

    const after = await redis.get(cursorKey)
    expect(after).toBe('5')
    expect(calls).toContain('janitor:save_failures:1v1')
  })

  it('increments save_failures:1v1 when batchInsertAliases throws', async () => {
    const cursorKey = `cursor:test:alias-fail:${Date.now()}`
    await redis.set(cursorKey, '5')
    const lockState: LockState = { lost: false, value: 'test-lock' }

    const { metrics, calls } = makeSpyMetrics()
    const failingRepo = {
      async getExistingPlayerNames() {
        return new Map<number, string>([[1, 'oldname']])
      },
      async batchInsertAliases() {
        throw new Error('forced alias failure')
      },
      async batchUpsertPlayers() {},
      async batchUpsertPlaceholderPlayers() {},
      async batchUpsertTeams() {},
    } as unknown as PlayerRepo

    const newSample = { ...SAMPLE, brawlhalla_id: 1, name: 'newname' }

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([newSample]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics,
    }

    await expect(sync1v1Page(deps, failingRepo, 'all', 1, 10, cursorKey, lockState)).rejects.toThrow(
      /forced alias failure/,
    )

    expect(calls).toContain('janitor:save_failures:1v1')
    const after = await redis.get(cursorKey)
    expect(after).toBe('5')
  })

  it('with cursorKey=null syncs the explicit page and does not touch any cursor', async () => {
    const lockState: LockState = { lost: false, value: 'test-lock' }
    const cursorScanBefore = await redis.keys('cursor:test:explicit:*')
    expect(cursorScanBefore.length).toBe(0)

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([{ ...SAMPLE, rank: 75 }]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [] })

    await sync1v1Page(deps, repo, 'us-e', 2, 2, null, lockState, { depth: 1 })

    const cursorScanAfter = await redis.keys('cursor:test:explicit:*')
    expect(cursorScanAfter.length).toBe(0)
  })

  it('enqueues vacated source pages to resync set at depth=0', async () => {
    const lockState: LockState = { lost: false, value: 'test-lock' }
    const queueKey = 'resync:1v1:queue'
    await redis.del(queueKey)

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([{ ...SAMPLE, rank: 151 }]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [3, 5, 41, 1] }) // page 1 filtered (hot), 41 filtered (out of cap), 3+5 kept

    await sync1v1Page(deps, repo, 'us-e', 4, 4, null, lockState, { depth: 0 })

    const queued = await redis.smembers(queueKey)
    await redis.del(queueKey)
    expect(queued.sort()).toEqual(['US-E:3', 'US-E:5'])
  })

  it('does not enqueue at depth=1 even when source pages are vacated', async () => {
    const lockState: LockState = { lost: false, value: 'test-lock' }
    const queueKey = 'resync:1v1:queue'
    await redis.del(queueKey)

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([{ ...SAMPLE, rank: 151 }]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [3, 5] })

    await sync1v1Page(deps, repo, 'us-e', 4, 4, null, lockState, { depth: 1 })

    const queued = await redis.smembers(queueKey)
    expect(queued).toEqual([])
  })
})

describe('renewLock heartbeat error handling', () => {
  it('treats redis.call rejection as lock-loss', async () => {
    const broken = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true })
    broken.disconnect()

    const lockState: LockState = { lost: false, value: 'test-lock' }
    const { metrics, calls } = makeSpyMetrics()

    const { renewLock } = await import('../commands/sync-rankings')
    await renewLock(broken, lockState, metrics)

    expect(lockState.lost).toBe(true)
    expect(calls).toContain('janitor:lock_lost_total')
  })
})

describe('drainResyncQueue', () => {
  it('drains all members within budget and processes each at depth=1', async () => {
    const queueKey = 'resync:1v1:queue'
    await redis.del(queueKey)
    await redis.sadd(queueKey, 'US-E:5', 'EU:7', 'BRZ:9')

    const calls: Array<{ region: string; page: number; depth: number }> = []
    const deps = {
      db: {} as never,
      bhapi: {
        remainingTokens: () => 1000,
        async getRankings1v1(region: Region, page: number) {
          calls.push({ region, page, depth: 1 })
          return [{ ...SAMPLE, rank: page * 50 }]
        },
        async getRankings2v2() {
          return []
        },
      } as unknown as BhApiClient,
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [] })

    const lockState: LockState = { lost: false, value: 'test-lock' }
    await drainResyncQueue(deps, repo, '1v1', lockState, performance.now())

    const remaining = await redis.smembers(queueKey)
    expect(remaining).toEqual([])
    expect(calls.length).toBe(3)
    const sorted = calls.map((c) => `${c.region}:${c.page}`).sort()
    // Drain lowercases the region back to BHAPI form (queue stores uppercase via normalizeRegionKey).
    expect(sorted).toEqual(['brz:9', 'eu:7', 'us-e:5'])
  })

  it('stops draining and re-adds remaining members when budget runs out mid-loop', async () => {
    const queueKey = 'resync:1v1:queue'
    await redis.del(queueKey)
    await redis.sadd(queueKey, 'US-E:5', 'EU:7', 'BRZ:9', 'AUS:11', 'JPN:13')

    // Start at JANITOR_MIN_TOKENS (10) + 2 so exactly 3 syncs run before tokens drop below threshold.
    let tokensLeft = 12
    const deps = {
      db: {} as never,
      bhapi: {
        remainingTokens: () => tokensLeft,
        async getRankings1v1() {
          tokensLeft--
          return [{ ...SAMPLE }]
        },
        async getRankings2v2() {
          return []
        },
      } as unknown as BhApiClient,
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [] })

    const lockState: LockState = { lost: false, value: 'test-lock' }
    await drainResyncQueue(deps, repo, '1v1', lockState, performance.now())

    const remaining = await redis.smembers(queueKey)
    await redis.del(queueKey)
    // 3 syncs ran (tokens 12->11->10->9), leaving 2 in the queue
    expect(remaining.length).toBe(2)
  })

  it('logs and counts errors but continues with remaining members', async () => {
    const queueKey = 'resync:1v1:queue'
    await redis.del(queueKey)
    await redis.sadd(queueKey, 'US-E:5', 'EU:7')
    const { metrics, calls } = makeSpyMetrics()

    let firstCall = true
    const deps = {
      db: {} as never,
      bhapi: {
        remainingTokens: () => 1000,
        async getRankings1v1() {
          if (firstCall) {
            firstCall = false
            throw new Error('forced bhapi failure')
          }
          return [{ ...SAMPLE }]
        },
        async getRankings2v2() {
          return []
        },
      } as unknown as BhApiClient,
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics,
    }
    const repo = makeFakeRepo()
    ;(repo as unknown as { replaceRankPage1v1: () => Promise<{ vacatedSourcePages: number[] }> }).replaceRankPage1v1 =
      async () => ({ vacatedSourcePages: [] })

    const lockState: LockState = { lost: false, value: 'test-lock' }
    await drainResyncQueue(deps, repo, '1v1', lockState, performance.now())

    expect(calls).toContain('janitor:resync_failures')
    const remaining = await redis.smembers(queueKey)
    await redis.del(queueKey)
    expect(remaining).toEqual([])
  })
})

describe('lockState abort', () => {
  it('aborts sync1v1Page when lockState.lost is set', async () => {
    const cursorKey = `cursor:test:lock-lost:${Date.now()}`
    await redis.set(cursorKey, '7')
    const lockState: LockState = { lost: true, value: 'test-lock' }

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([SAMPLE]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }

    await expect(sync1v1Page(deps, makeFakeRepo(), 'all', 1, 10, cursorKey, lockState)).rejects.toThrow(/lock lost/i)

    const after = await redis.get(cursorKey)
    expect(after).toBe('7')
  })
})
