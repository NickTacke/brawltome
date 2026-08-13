import { describe, expect, test } from 'bun:test'
import type { LeaderboardMode, RankingQueries } from '@brawltome/ranking'
import { leaderboardRouter } from '../src/router/leaderboard.router'
import type { Context } from '../src/trpc/context'

function callerFor(
  getLeaderboard: RankingQueries['getLeaderboard'],
  referenceById: Context['playerReferenceQueries']['byId'] = async () => null,
) {
  const rankingQueries: RankingQueries = { getLeaderboard }
  return leaderboardRouter.createCaller({
    rankingQueries,
    playerReferenceQueries: { byId: referenceById },
  } as Context)
}

describe('leaderboard.get', () => {
  test('routes every mode through Ranking and forwards the pagination snapshot', async () => {
    const calls: unknown[] = []
    const caller = callerFor(async (input) => {
      calls.push(input)
      return {
        status: 'unavailable',
        reason: 'not_yet_published',
        mode: input.mode,
        page: input.page,
        pageSize: input.pageSize ?? 20,
      }
    })
    const snapshotId = '10000000-0000-4000-8000-000000000001'
    for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
      await expect(caller.get({ mode, region: 'all', page: 2, pageSize: 20, snapshotId })).resolves.toEqual({
        status: 'unavailable',
        reason: 'not_yet_published',
        mode,
        page: 2,
        pageSize: 20,
      })
    }
    expect(calls).toEqual(
      (['1v1', '2v2', 'solo2v2', '3v3'] as LeaderboardMode[]).map((mode) => ({
        mode,
        region: 'all',
        page: 2,
        pageSize: 20,
        snapshotId,
      })),
    )
    await expect(caller.get({ mode: '1v1', region: 'all', page: 1, sort: 'wins' } as never)).rejects.toThrow()
  })

  test('maps explicit identities and rejects malformed producer output', async () => {
    const caller = callerFor(
      async (input) => ({
        status: 'fresh',
        snapshotId: '10000000-0000-4000-8000-000000000001',
        generationId: '10000000-0000-4000-8000-000000000002',
        mode: input.mode,
        region: input.region,
        observedAt: '2026-08-09T12:00:00Z',
        publishedAt: '2026-08-09T12:00:01Z',
        expectedNextPublicationAt: '2026-08-09T12:15:00Z',
        provenance: { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 1, pageDepth: 1 },
        page: 1,
        pageSize: 20,
        hasMore: false,
        totalRows: 1,
        entries: [
          {
            standing: 1,
            sourceRank: 4,
            identity: { type: 'solo-two-vs-two-player', player: { brawlhallaId: 42, name: 'Ada' } },
            region: 'EU',
            rating: 2100,
            peakRating: 2200,
            wins: 20,
            losses: 10,
            games: 30,
            tier: 'Diamond',
          },
        ],
      }),
      async (brawlhallaId) => ({ brawlhallaId, name: 'Current Ada', bestLegendNameKey: 'bodvar' }),
    )
    await expect(caller.get({ mode: 'solo2v2', region: 'EU', page: 1 })).resolves.toMatchObject({
      mode: 'solo2v2',
      entries: [
        {
          standing: 1,
          sourceRank: 4,
          identity: {
            type: 'solo-two-vs-two-player',
            player: { brawlhallaId: 42, name: 'Current Ada', bestLegendNameKey: 'bodvar' },
          },
        },
      ],
    })

    const malformed = callerFor(
      async (input) =>
        ({
          status: 'unavailable',
          reason: 'not_yet_published',
          mode: input.mode,
          page: input.page,
          pageSize: input.pageSize ?? 20,
          entries: [],
        }) as never,
    )
    await expect(malformed.get({ mode: '3v3', region: 'EU', page: 1 })).rejects.toThrow()
  })
})
