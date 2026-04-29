import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { PlayerRepo } from '@brawltome/player'
import type { MetricsRegistry } from '@brawltome/shared'
import Redis from 'ioredis'
import type { PageResponse } from '../commands/leaderboard-endpoint'
import { startSweep, sweepBracket } from '../commands/sweep-leaderboards'

type SweepRepo = Pick<PlayerRepo, 'sweepUpsert1v1' | 'sweepUpsert3v3' | 'sweepUpsert2v2' | 'sweepUpsertSolo2v2'>

type Upsert1v1Rows = Parameters<SweepRepo['sweepUpsert1v1']>[0]
type Upsert3v3Rows = Parameters<SweepRepo['sweepUpsert3v3']>[0]
type Upsert2v2Rows = Parameters<SweepRepo['sweepUpsert2v2']>[0]
type UpsertSolo2v2Rows = Parameters<SweepRepo['sweepUpsertSolo2v2']>[0]

interface FakeRepo extends SweepRepo {
  upsert1v1Calls: Upsert1v1Rows[]
  upsert3v3Calls: Upsert3v3Rows[]
  upsert2v2Calls: Upsert2v2Rows[]
  upsertSoloCalls: UpsertSolo2v2Rows[]
}

function makeFakeRepo(): FakeRepo {
  const f: FakeRepo = {
    upsert1v1Calls: [],
    upsert3v3Calls: [],
    upsert2v2Calls: [],
    upsertSoloCalls: [],
    sweepUpsert1v1: async (r) => {
      f.upsert1v1Calls.push(r)
    },
    sweepUpsert3v3: async (r) => {
      f.upsert3v3Calls.push(r)
    },
    sweepUpsert2v2: async (r) => {
      f.upsert2v2Calls.push(r)
    },
    sweepUpsertSolo2v2: async (r) => {
      f.upsertSoloCalls.push(r)
    },
  }
  return f
}

// PlayerRepo type is huge — startSweep only ever calls the four sweep methods,
// so cast through `unknown` to hand the test fake to the production code path.
function asRepo(r: SweepRepo): PlayerRepo {
  return r as unknown as PlayerRepo
}

function makeFakeFetcher(pagesByNumber: Map<number, PageResponse>) {
  const pageNumbersFetched: number[] = []
  return {
    pagesFetched: pageNumbersFetched,
    fetch: async (opts: { bracket: string; page: number }) => {
      pageNumbersFetched.push(opts.page)
      const r = pagesByNumber.get(opts.page)
      if (!r) throw new Error(`fake fetcher: no page ${opts.page}`)
      return r
    },
  }
}

describe('sweepBracket 1v1', () => {
  it('reads total_pages from page 1, fans out 2..N, upserts each row', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 2,
          rankings: [
            {
              id: 1,
              username: 'A',
              rating: 2000,
              best_rating: 2100,
              rank: 1,
              wins: 50,
              losses: 10,
              region: 'US-E',
              tier: 'Diamond',
            },
          ] as never,
        },
      ],
      [
        2,
        {
          total_pages: 2,
          rankings: [
            {
              id: 2,
              username: 'B',
              rating: 1900,
              best_rating: 1950,
              rank: 2,
              wins: 40,
              losses: 20,
              region: 'EU',
              tier: 'Diamond',
            },
          ] as never,
        },
      ],
    ])
    const fakeFetcher = makeFakeFetcher(pages)
    const repo = makeFakeRepo()

    const result = await sweepBracket({
      bracket: '1v1',
      repo: asRepo(repo),
      fetchPage: fakeFetcher.fetch,
      concurrency: 5,
      onTierFallback: () => {},
    })

    expect(fakeFetcher.pagesFetched.sort()).toEqual([1, 2])
    expect(result.pagesOk).toBe(2)
    expect(result.pagesSkipped).toBe(0)
    expect(
      repo.upsert1v1Calls
        .flat()
        .map((r) => r.brawlhallaId)
        .sort(),
    ).toEqual([1, 2])
  })

  it('normalizes JPS region to JPN', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 1,
          rankings: [
            {
              id: 5,
              username: 'JpPlayer',
              rating: 1500,
              best_rating: 1500,
              rank: 1,
              wins: 5,
              losses: 5,
              region: 'JPS',
              tier: 'Gold',
            },
          ] as never,
        },
      ],
    ])
    const repo = makeFakeRepo()
    await sweepBracket({
      bracket: '1v1',
      repo: asRepo(repo),
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: () => {},
    })
    expect(repo.upsert1v1Calls.flat()[0].region).toBe('JPN')
  })

  it('applies tier fallback for missing tier with peak >= 2000', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 1,
          rankings: [
            {
              id: 7,
              username: 'X',
              rating: 1900,
              best_rating: 2200,
              rank: 1,
              wins: 200,
              losses: 150,
              region: 'EU',
            },
          ] as never,
        },
      ],
    ])
    const repo = makeFakeRepo()
    const fallbacks: string[] = []
    await sweepBracket({
      bracket: '1v1',
      repo: asRepo(repo),
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: (k) => fallbacks.push(k),
    })
    expect(repo.upsert1v1Calls.flat()[0].tier).toBe('Diamond')
    expect(fallbacks).toEqual(['diamond'])
  })

  it('counts a skipped page when fetch throws after retry', async () => {
    const repo = makeFakeRepo()
    const result = await sweepBracket({
      bracket: '1v1',
      repo: asRepo(repo),
      fetchPage: async (opts) => {
        if (opts.page === 1) {
          return {
            total_pages: 3,
            rankings: [
              {
                id: 1,
                username: 'A',
                rating: 1,
                best_rating: 1,
                rank: 1,
                wins: 0,
                losses: 0,
                region: 'EU',
                tier: 'Tin 0',
              } as never,
            ],
          }
        }
        if (opts.page === 2) throw new Error('always fails')
        return {
          total_pages: 3,
          rankings: [
            {
              id: 3,
              username: 'C',
              rating: 1,
              best_rating: 1,
              rank: 3,
              wins: 0,
              losses: 0,
              region: 'EU',
              tier: 'Tin 0',
            } as never,
          ],
        }
      },
      concurrency: 1,
      onTierFallback: () => {},
    })
    expect(result.pagesOk).toBe(2)
    expect(result.pagesSkipped).toBe(1)
    expect(result.pagesFailed).toBe(0)
  })

  it('counts a failed page when repo write throws', async () => {
    const repo: SweepRepo = {
      sweepUpsert1v1: async () => {
        throw new Error('db down')
      },
      sweepUpsert3v3: async () => {},
      sweepUpsert2v2: async () => {},
      sweepUpsertSolo2v2: async () => {},
    }
    const result = await sweepBracket({
      bracket: '1v1',
      repo: asRepo(repo),
      fetchPage: async () => ({
        total_pages: 1,
        rankings: [
          {
            id: 1,
            username: 'A',
            rating: 1,
            best_rating: 1,
            rank: 1,
            wins: 0,
            losses: 0,
            region: 'EU',
            tier: 'Tin 0',
          } as never,
        ],
      }),
      concurrency: 1,
      onTierFallback: () => {},
    })
    expect(result.pagesOk).toBe(0)
    expect(result.pagesSkipped).toBe(0)
    expect(result.pagesFailed).toBe(1)
  })
})

describe('sweepBracket 2v2', () => {
  it('passes both player ids, usernames, and team rating to sweepUpsert2v2', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 1,
          rankings: [
            {
              players: [
                { id: 100, username: 'Alpha' },
                { id: 200, username: 'Beta' },
              ],
              rating: 1900,
              best_rating: 2000,
              rank: 1,
              wins: 30,
              losses: 10,
              region: 'EU',
              tier: 'Diamond',
            } as never,
          ],
        },
      ],
    ])
    const repo = makeFakeRepo()
    await sweepBracket({
      bracket: '2v2',
      repo: asRepo(repo),
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: () => {},
    })
    const team = repo.upsert2v2Calls.flat()[0]
    expect(team.brawlhallaIdOne).toBe(100)
    expect(team.brawlhallaIdTwo).toBe(200)
    expect(team.playerOneName).toBe('Alpha')
    expect(team.playerTwoName).toBe('Beta')
    expect(team.rating).toBe(1900)
  })
})

describe('sweepBracket solo_2v2', () => {
  it('passes single-player rows to sweepUpsertSolo2v2', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 1,
          rankings: [
            {
              players: [{ id: 300, username: 'Solo' }],
              rating: 1700,
              best_rating: 1750,
              rank: 1,
              wins: 30,
              losses: 20,
              region: 'EU',
              tier: 'Platinum 1',
            } as never,
          ],
        },
      ],
    ])
    const repo = makeFakeRepo()
    await sweepBracket({
      bracket: 'solo_2v2',
      repo: asRepo(repo),
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: () => {},
    })
    const row = repo.upsertSoloCalls.flat()[0]
    expect(row.brawlhallaId).toBe(300)
    expect(row.region).toBe('EU')
  })
})

let redis: Redis
beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
})
afterAll(async () => {
  await redis.del('sweep:lock').catch(() => {})
  await redis.quit()
})

const NULL_METRICS: MetricsRegistry = {
  incrementQueue: async () => {},
  snapshotQueue: async () => ({}),
  snapshotAllQueues: async () => ({}),
  setScalar: async () => {},
  getScalar: async () => null,
  incrementCounter: async () => {},
  snapshotCounters: async () => ({}),
}

describe('startSweep', () => {
  it('skips when another instance already holds the lock', async () => {
    await redis.set('sweep:lock', 'other-instance', 'EX', 60)
    let calls = 0
    const stop = startSweep({
      redis,
      repo: asRepo(makeFakeRepo()),
      metrics: NULL_METRICS,
      fetchPage: async () => {
        calls++
        return { total_pages: 1, rankings: [] }
      },
      tickIntervalMs: 100,
      sweepIntervalMs: 50,
    })
    await new Promise((r) => setTimeout(r, 250))
    await stop()
    await redis.del('sweep:lock')
    expect(calls).toBe(0)
  })

  it('runs at least one sweep when the lock is free', async () => {
    await redis.del('sweep:lock')
    let calls = 0
    const stop = startSweep({
      redis,
      repo: asRepo(makeFakeRepo()),
      metrics: NULL_METRICS,
      fetchPage: async () => {
        calls++
        return { total_pages: 1, rankings: [] }
      },
      tickIntervalMs: 50,
      sweepIntervalMs: 200,
    })
    // Wait long enough for at least one sweep window.
    await new Promise((r) => setTimeout(r, 250))
    await stop()
    // Each sweep fetches page 1 of 4 brackets = 4 calls per sweep; expect at least 4.
    expect(calls).toBeGreaterThanOrEqual(4)
    expect(calls).toBeLessThanOrEqual(12)
  })

  it('reschedules and recovers when redis throws inside acquireLock', async () => {
    // Fail the first acquireLock call, then succeed (with a free lock) on the second.
    // If tick() did not catch the throw, schedule() would never run and `calls` would stay 0.
    await redis.del('sweep:lock').catch(() => {})
    let setCalls = 0
    const realRedis = redis
    const fakeRedis = new Proxy(realRedis, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return async (...args: unknown[]) => {
            setCalls++
            if (setCalls === 1) throw new Error('transient redis outage')
            // biome-ignore lint/suspicious/noExplicitAny: forwarding to ioredis variadic set()
            return (target.set as any)(...args)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    }) as Redis

    let fetchCalls = 0
    const stop = startSweep({
      redis: fakeRedis,
      repo: asRepo(makeFakeRepo()),
      metrics: NULL_METRICS,
      fetchPage: async () => {
        fetchCalls++
        return { total_pages: 1, rankings: [] }
      },
      tickIntervalMs: 50,
      sweepIntervalMs: 50,
    })
    await new Promise((r) => setTimeout(r, 400))
    await stop()
    await redis.del('sweep:lock').catch(() => {})
    // First tick threw inside acquireLock; subsequent ticks must still fire and run a sweep.
    expect(setCalls).toBeGreaterThanOrEqual(2)
    expect(fetchCalls).toBeGreaterThanOrEqual(4)
  })
})
