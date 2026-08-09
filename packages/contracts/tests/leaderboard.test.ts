import { describe, expect, test } from 'bun:test'
import { leaderboard1v1InputSchema, leaderboard1v1OutputSchema, parseLeaderboard1v1Output } from '../src/leaderboard'

const row = {
  standing: 1,
  sourceRank: 3,
  brawlhallaId: 42,
  name: 'Ada',
  region: 'EU' as const,
  rating: 2100,
  peakRating: 2200,
  wins: 20,
  losses: 10,
  games: 30,
  tier: 'Diamond',
}

const available = {
  status: 'fresh' as const,
  snapshotId: '10000000-0000-4000-8000-000000000001',
  generationId: '10000000-0000-4000-8000-000000000002',
  region: 'all' as const,
  observedAt: '2026-08-09T12:00:00Z',
  publishedAt: '2026-08-09T12:00:01Z',
  expectedNextPublicationAt: '2026-08-09T12:15:00Z',
  provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 1 as const, pageDepth: 1 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  totalRows: 1,
  entries: [row],
}

describe('1v1 leaderboard contracts', () => {
  test('accepts canonical fresh, stale, and typed unavailable results', () => {
    expect(parseLeaderboard1v1Output(available)).toEqual(available)
    expect(parseLeaderboard1v1Output({ ...available, status: 'stale' })).toMatchObject({ status: 'stale' })
    expect(
      parseLeaderboard1v1Output({ status: 'unavailable', reason: 'not_yet_published', page: 1, pageSize: 20 }),
    ).toEqual({ status: 'unavailable', reason: 'not_yet_published', page: 1, pageSize: 20 })
    expect(
      parseLeaderboard1v1Output({ status: 'unavailable', reason: 'snapshot_not_found', page: 2, pageSize: 20 }),
    ).toMatchObject({ status: 'unavailable', reason: 'snapshot_not_found' })
  })

  test('rejects malformed timestamps, ranks, counts, and persistence-shaped output', () => {
    for (const value of [
      { ...available, observedAt: '2026-08-09T12:00:00+00:00' },
      { ...available, entries: [{ ...row, standing: 0 }] },
      { ...available, entries: [{ ...row, games: 31 }] },
      {
        ...available,
        entries: [{ ...row, wins: 2_147_483_647, losses: 1, games: 2_147_483_648 }],
      },
      { ...available, entries: [{ ...row, region: 'mars' }] },
      { ...available, internalColumn: true },
      { status: 'unavailable', reason: 'not_yet_published', page: 1, pageSize: 20, entries: [] },
    ]) {
      expect(() => leaderboard1v1OutputSchema.parse(value)).toThrow()
    }
  })

  test('bounds canonical input, pins optional snapshots, and preserves Global as all', () => {
    const snapshotId = '10000000-0000-4000-8000-000000000001'
    expect(
      leaderboard1v1InputSchema.parse({ bracket: '1v1', region: 'all', page: 1, pageSize: 20, snapshotId }),
    ).toEqual({
      bracket: '1v1',
      region: 'all',
      page: 1,
      pageSize: 20,
      snapshotId,
    })
    expect(() => leaderboard1v1InputSchema.parse({ bracket: '2v2', region: 'all', page: 1 })).toThrow()
    expect(() => leaderboard1v1InputSchema.parse({ bracket: '1v1', region: 'EU', page: 0 })).toThrow()
  })
})
