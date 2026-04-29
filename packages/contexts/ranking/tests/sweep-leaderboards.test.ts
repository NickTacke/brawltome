import { describe, expect, it } from 'bun:test'
import type { PageResponse } from '../commands/leaderboard-endpoint'
import { sweepBracket } from '../commands/sweep-leaderboards'

interface FakeRepo {
  upsert1v1Calls: any[][]
  upsert3v3Calls: any[][]
  upsert2v2Calls: any[][]
  upsertSoloCalls: any[][]
}

function makeFakeRepo(): FakeRepo & {
  sweepUpsert1v1: (r: any[]) => Promise<void>
  sweepUpsert3v3: (r: any[]) => Promise<void>
  sweepUpsert2v2: (r: any[]) => Promise<void>
  sweepUpsertSolo2v2: (r: any[]) => Promise<void>
} {
  const f: any = { upsert1v1Calls: [], upsert3v3Calls: [], upsert2v2Calls: [], upsertSoloCalls: [] }
  f.sweepUpsert1v1 = async (r: any[]) => {
    f.upsert1v1Calls.push(r)
  }
  f.sweepUpsert3v3 = async (r: any[]) => {
    f.upsert3v3Calls.push(r)
  }
  f.sweepUpsert2v2 = async (r: any[]) => {
    f.upsert2v2Calls.push(r)
  }
  f.sweepUpsertSolo2v2 = async (r: any[]) => {
    f.upsertSoloCalls.push(r)
  }
  return f
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
      repo: repo as any,
      fetchPage: fakeFetcher.fetch,
      concurrency: 5,
      onTierFallback: () => {},
    })

    expect(fakeFetcher.pagesFetched.sort()).toEqual([1, 2])
    expect(result.pagesOk).toBe(2)
    expect(result.pagesSkipped).toBe(0)
    expect(repo.upsert1v1Calls.flat().map((r) => r.brawlhallaId).sort()).toEqual([1, 2])
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
      repo: repo as any,
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
      repo: repo as any,
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
      repo: repo as any,
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
    const repo: any = {
      sweepUpsert1v1: async () => {
        throw new Error('db down')
      },
      sweepUpsert3v3: async () => {},
      sweepUpsert2v2: async () => {},
      sweepUpsertSolo2v2: async () => {},
    }
    const result = await sweepBracket({
      bracket: '1v1',
      repo,
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
  it('passes both player ids and team rating to sweepUpsert2v2', async () => {
    const pages = new Map<number, PageResponse>([
      [
        1,
        {
          total_pages: 1,
          rankings: [
            {
              players: [
                { id: 100, username: 'A' },
                { id: 200, username: 'B' },
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
      repo: repo as any,
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: () => {},
    })
    const team = repo.upsert2v2Calls.flat()[0]
    expect(team.brawlhallaIdOne).toBe(100)
    expect(team.brawlhallaIdTwo).toBe(200)
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
      repo: repo as any,
      fetchPage: makeFakeFetcher(pages).fetch,
      concurrency: 1,
      onTierFallback: () => {},
    })
    const row = repo.upsertSoloCalls.flat()[0]
    expect(row.brawlhallaId).toBe(300)
    expect(row.region).toBe('EU')
  })
})
