import { describe, expect, test } from 'bun:test'
import type { LeaderboardMode, RankingQueries } from '@brawltome/ranking'
import { leaderboardRouter } from '../src/router/leaderboard.router'
import type { Context } from '../src/trpc/context'

function callerFor(
  getLeaderboard: RankingQueries['getLeaderboard'] = async (input) => ({
    status: 'unavailable',
    reason: 'not_yet_published',
    mode: input.mode,
    page: input.page,
    pageSize: input.pageSize ?? 20,
  }),
  referenceById: Context['playerReferenceQueries']['byId'] = async () => null,
  getRecentActivity: RankingQueries['getRecentActivity'] = async (input) => ({
    status: 'unavailable',
    reason: 'not_enough_history',
    mode: input.mode,
    region: input.region,
    page: input.page,
    pageSize: input.pageSize ?? 20,
  }),
) {
  const rankingQueries: RankingQueries = { getLeaderboard, getRecentActivity }
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
      async (brawlhallaId) => ({
        brawlhallaId,
        name: 'Current Ada',
        aliases: [],
        bestLegendNameKey: 'bodvar',
      }),
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

  test('preserves distinct source labels for same-account couch team slots', async () => {
    const caller = callerFor(
      async () => ({
        status: 'fresh',
        snapshotId: '10000000-0000-4000-8000-000000000001',
        generationId: '10000000-0000-4000-8000-000000000002',
        mode: '2v2',
        region: 'EU',
        observedAt: '2026-08-09T12:00:00Z',
        publishedAt: '2026-08-09T12:00:01Z',
        expectedNextPublicationAt: '2026-08-09T12:15:00Z',
        provenance: { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 },
        page: 1,
        pageSize: 20,
        hasMore: false,
        totalRows: 1,
        entries: [
          {
            standing: 1,
            sourceRank: 1,
            identity: {
              type: 'fixed-two-vs-two-team',
              players: [
                { brawlhallaId: 42, name: 'Ada' },
                { brawlhallaId: 42, name: 'Ada•2' },
              ],
            },
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
      async (brawlhallaId) => ({
        brawlhallaId,
        name: 'Current Ada',
        aliases: [],
        bestLegendNameKey: 'bodvar',
      }),
    )

    await expect(caller.get({ mode: '2v2', region: 'EU', page: 1 })).resolves.toMatchObject({
      entries: [
        {
          identity: {
            players: [
              { name: 'Ada', bestLegendNameKey: 'bodvar' },
              { name: 'Ada•2', bestLegendNameKey: 'bodvar' },
            ],
          },
        },
      ],
    })
  })
})

const activityBase = {
  status: 'fresh' as const,
  mode: '1v1' as const,
  region: 'EU' as const,
  currentSnapshotId: '10000000-0000-4000-8000-000000000004',
  previousObservedAt: '2026-08-17T12:00:00Z',
  currentObservedAt: '2026-08-17T12:15:00Z',
  publishedAt: '2026-08-17T12:16:00Z',
  expectedNextPublicationAt: '2026-08-17T12:30:00Z',
  provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 2 as const, pageDepth: 20 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  totalRows: 1,
}

const activityMetrics = {
  standing: 4,
  region: 'EU' as const,
  rating: 2300,
  ratingDelta: -12,
  winsDelta: 1,
  lossesDelta: 2,
  gamesDelta: 3,
}

describe('leaderboard.recentActivity', () => {
  test('forwards filters and snapshot pinning while rejecting malformed or unknown input', async () => {
    const calls: unknown[] = []
    const caller = callerFor(undefined, undefined, async (input) => {
      calls.push(input)
      return {
        status: 'unavailable',
        reason: 'not_enough_history',
        mode: input.mode,
        region: input.region,
        page: input.page,
        pageSize: input.pageSize ?? 20,
      }
    })
    const snapshotId = activityBase.currentSnapshotId
    await expect(
      caller.recentActivity({ mode: 'solo2v2', region: 'SA', page: 2, pageSize: 50, snapshotId }),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'not_enough_history' })
    expect(calls).toEqual([{ mode: 'solo2v2', region: 'SA', page: 2, pageSize: 50, snapshotId }])
    await expect(
      caller.recentActivity({ mode: '1v1', region: 'all', page: 1, snapshotId: 'invalid' }),
    ).rejects.toThrow()
    await expect(
      caller.recentActivity({ mode: '1v1', region: 'all', page: 1, online: true } as never),
    ).rejects.toThrow()
  })

  test('enriches only returned fixed-team slots', async () => {
    const lookedUp: number[] = []
    const caller = callerFor(
      undefined,
      async (brawlhallaId) => {
        lookedUp.push(brawlhallaId)
        return { brawlhallaId, name: `Current ${brawlhallaId}`, aliases: [], bestLegendNameKey: 'bodvar' }
      },
      async () => ({
        ...activityBase,
        mode: '2v2',
        entries: [
          {
            ...activityMetrics,
            identity: {
              type: 'fixed-two-vs-two-team',
              players: [
                { brawlhallaId: 42, name: 'Ada' },
                { brawlhallaId: 43, name: 'Bodvar' },
              ],
            },
          },
        ],
      }),
    )
    await expect(caller.recentActivity({ mode: '2v2', region: 'EU', page: 1 })).resolves.toMatchObject({
      entries: [
        {
          identity: {
            players: [
              { name: 'Current 42', bestLegendNameKey: 'bodvar' },
              { name: 'Current 43', bestLegendNameKey: 'bodvar' },
            ],
          },
        },
      ],
    })
    expect(lookedUp.sort()).toEqual([42, 43])
  })

  test('rejects malformed producer activity and normalizes unexpected failures', async () => {
    for (const entry of [
      {
        ...activityMetrics,
        online: true,
        identity: { type: 'one-vs-one-player', player: { brawlhallaId: 42, name: 'Ada' } },
      },
      {
        ...activityMetrics,
        gamesDelta: 4,
        identity: { type: 'one-vs-one-player', player: { brawlhallaId: 42, name: 'Ada' } },
      },
    ]) {
      const malformed = callerFor(undefined, undefined, async () => ({ ...activityBase, entries: [entry] }) as never)
      await expect(malformed.recentActivity({ mode: '1v1', region: 'EU', page: 1 })).rejects.toThrow()
    }
    const failed = callerFor(undefined, undefined, async () => {
      throw new Error('SELECT secret FROM internal_table')
    })
    await expect(failed.recentActivity({ mode: '1v1', region: 'EU', page: 1 })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    })
  })
})
