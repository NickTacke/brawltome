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

describe('sync1v1Page', () => {
  it('does not advance cursor when batchUpsertPlayers throws', async () => {
    const cursorKey = `cursor:test:save-fail:${Date.now()}`
    await redis.set(cursorKey, '5')
    const lockState: LockState = { lost: false, value: 'test-lock' }

    const deps = {
      db: {} as never,
      bhapi: makeFakeBhapi([SAMPLE]),
      redis,
      rankedQueue: {} as never,
      statsQueue: {} as never,
      clanQueue: {} as never,
      metrics: NULL_METRICS,
    }

    await expect(
      sync1v1Page(deps, makeFakeRepo({ upsertThrows: true }), 'all', 1, 10, cursorKey, lockState),
    ).rejects.toThrow(/forced db failure/)

    const after = await redis.get(cursorKey)
    expect(after).toBe('5')
  })
})
