import { describe, expect, test } from 'bun:test'
import type { RankingQueries } from '@brawltome/ranking'
import { loadLaunchCohortCandidates } from '../src/statistics-cohort-reconciliation'

const snapshotId = '00000000-0000-4000-8000-000000000001'
const generationId = '10000000-0000-4000-8000-000000000001'

function view(page: number, ids: number[], hasMore: boolean) {
  return {
    status: 'fresh' as const,
    snapshotId,
    generationId,
    mode: '1v1' as const,
    region: 'EU' as const,
    observedAt: '2026-08-10T00:00:00.000Z',
    publishedAt: '2026-08-10T00:01:00.000Z',
    expectedNextPublicationAt: '2026-08-17T00:00:00.000Z',
    provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 1 as const, pageDepth: 2 },
    page,
    pageSize: 100,
    hasMore,
    totalRows: 3,
    entries: ids.map((id, index) => ({
      standing: (page - 1) * 100 + index + 1,
      sourceRank: (page - 1) * 100 + index + 1,
      identity: { type: 'one-vs-one-player' as const, player: { brawlhallaId: id, name: `Player ${id}` } },
      region: 'EU' as const,
      rating: 2000 + id,
      peakRating: 2100 + id,
      wins: 10,
      losses: 5,
      games: 15,
      tier: 'Diamond',
    })),
  }
}

describe('Statistics immutable Ranking adapter', () => {
  test('pins every page to the first snapshot and preserves generation lineage', async () => {
    const calls: Array<{ page: number; snapshotId?: string }> = []
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        calls.push({ page: input.page, snapshotId: input.snapshotId })
        return input.page === 1 ? view(1, [1, 2], true) : view(2, [3], false)
      },
    }
    expect(await loadLaunchCohortCandidates(ranking)).toEqual({
      snapshotId,
      generationId,
      observedAt: '2026-08-10T00:00:00.000Z',
      region: 'EU',
      mode: '1v1',
      candidates: [
        { brawlhallaId: 1, rating: 2001 },
        { brawlhallaId: 2, rating: 2002 },
        { brawlhallaId: 3, rating: 2003 },
      ],
    })
    expect(calls).toEqual([
      { page: 1, snapshotId: undefined },
      { page: 2, snapshotId },
    ])
  })

  test('returns no cohort before Rankings publishes the EU snapshot', async () => {
    const ranking: RankingQueries = {
      async getLeaderboard(input) {
        return {
          status: 'unavailable',
          reason: 'not_yet_published',
          mode: input.mode,
          page: input.page,
          pageSize: input.pageSize ?? 50,
        }
      },
    }
    expect(await loadLaunchCohortCandidates(ranking)).toBeNull()
  })
})
