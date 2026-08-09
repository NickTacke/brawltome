import { describe, expect, test } from 'bun:test'
import type { RankingQueries } from '@brawltome/ranking'
import { leaderboardRouter } from '../src/router/leaderboard.router'
import type { Context } from '../src/trpc/context'

function callerFor(rankingQueries: RankingQueries) {
  return leaderboardRouter.createCaller({
    rankingQueries,
    playerRepo: new Proxy(
      {},
      {
        get() {
          throw new Error('canonical 1v1 queries must not read Players')
        },
      },
    ),
  } as Context)
}

describe('leaderboard.oneVsOne', () => {
  test('uses the canonical input and returns typed unavailability before first publication', async () => {
    const calls: unknown[] = []
    const caller = callerFor({
      async get1v1(input) {
        calls.push(input)
        return { status: 'unavailable', reason: 'not_yet_published', page: input.page, pageSize: input.pageSize ?? 20 }
      },
    })
    const snapshotId = '10000000-0000-4000-8000-000000000001'
    await expect(
      caller.oneVsOne({ bracket: '1v1', region: 'all', page: 2, pageSize: 20, snapshotId }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not_yet_published', page: 2, pageSize: 20 })
    expect(calls).toEqual([{ region: 'all', page: 2, pageSize: 20, snapshotId }])
    await expect(caller.oneVsOne({ bracket: '1v1', region: 'all', page: 1, sort: 'wins' } as never)).rejects.toThrow()
  })

  test('rejects malformed producer output at the canonical mapper', async () => {
    const caller = callerFor({
      async get1v1(input) {
        return {
          status: 'unavailable',
          reason: 'not_yet_published',
          page: input.page,
          pageSize: input.pageSize ?? 20,
          entries: [],
        } as never
      },
    })
    await expect(caller.oneVsOne({ bracket: '1v1', region: 'EU', page: 1 })).rejects.toThrow()
  })
})
