import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { BhApiClient, BhApiRanking1v1 } from '@brawltome/bhapi'
import type { PlayerRepo } from '@brawltome/player'
import type { MetricsRegistry } from '@brawltome/shared'
import Redis from 'ioredis'
import { type LockState, sync1v1Page } from '../commands/sync-rankings'

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
