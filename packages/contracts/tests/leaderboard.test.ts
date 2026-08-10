import { describe, expect, test } from 'bun:test'
import { leaderboardInputSchema, leaderboardOutputSchema, parseLeaderboardOutput } from '../src/leaderboard'

const common = {
  status: 'fresh' as const,
  snapshotId: '00000000-0000-4000-8000-000000000001',
  generationId: '00000000-0000-4000-8000-000000000002',
  region: 'EU' as const,
  observedAt: '2026-08-09T12:00:00Z',
  publishedAt: '2026-08-09T12:00:01Z',
  expectedNextPublicationAt: '2026-08-09T12:15:00Z',
  provenance: { source: 'brawlhalla-v1-ranked-leaderboard' as const, contractVersion: 1 as const, pageDepth: 1 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  totalRows: 1,
}
const metrics = {
  standing: 1,
  sourceRank: 4,
  region: 'EU' as const,
  rating: 2100,
  peakRating: 2200,
  wins: 20,
  losses: 10,
  games: 30,
  tier: 'Diamond',
}
const player = { brawlhallaId: 42, name: 'Ada' }

const entries = {
  '1v1': [{ ...metrics, identity: { type: 'one-vs-one-player' as const, player } }],
  '2v2': [
    {
      ...metrics,
      identity: {
        type: 'fixed-two-vs-two-team' as const,
        players: [player, { brawlhallaId: 43, name: 'Bodvar' }],
      },
    },
  ],
  solo2v2: [{ ...metrics, identity: { type: 'solo-two-vs-two-player' as const, player } }],
  '3v3': [{ ...metrics, identity: { type: 'three-vs-three-player' as const, player } }],
}

describe('leaderboard contract', () => {
  test('accepts every canonical mode input and rejects legacy or unknown fields', () => {
    for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
      expect(leaderboardInputSchema.parse({ mode, region: 'all', page: 1 })).toEqual({ mode, region: 'all', page: 1 })
    }
    expect(() => leaderboardInputSchema.parse({ bracket: '1v1', region: 'all', page: 1 })).toThrow()
    expect(() => leaderboardInputSchema.parse({ mode: 'solo_2v2', region: 'all', page: 1 })).toThrow()
    expect(() => leaderboardInputSchema.parse({ mode: '1v1', region: 'all', page: 1, extra: true })).toThrow()
  })

  test('round-trips strict mode-specific identity discriminants', () => {
    for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
      const output = { ...common, mode, entries: entries[mode] }
      const parsed = parseLeaderboardOutput(output)
      expect(parsed.mode).toBe(mode)
      expect(parsed).toEqual(output as never)
    }
  })

  test('cannot deserialize one mode identity as another', () => {
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: 'solo2v2', entries: entries['1v1'] })).toThrow()
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: '3v3', entries: entries['2v2'] })).toThrow()
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: '2v2', entries: entries.solo2v2 })).toThrow()
  })

  test('rejects zero IDs, noncanonical or duplicate fixed teams, inconsistent games, and unknown output fields', () => {
    const fixed = entries['2v2'][0]
    for (const identity of [
      { type: 'fixed-two-vs-two-team', players: [{ brawlhallaId: 0, name: 'Zero' }, player] },
      { type: 'fixed-two-vs-two-team', players: [player, player] },
      { type: 'fixed-two-vs-two-team', players: [{ brawlhallaId: 43, name: 'B' }, player] },
    ]) {
      expect(() =>
        leaderboardOutputSchema.parse({ ...common, mode: '2v2', entries: [{ ...fixed, identity }] }),
      ).toThrow()
    }
    expect(() =>
      leaderboardOutputSchema.parse({ ...common, mode: '1v1', entries: [{ ...entries['1v1'][0], games: 29 }] }),
    ).toThrow()
    expect(() =>
      leaderboardOutputSchema.parse({ ...common, mode: '1v1', entries: entries['1v1'], persistence: true }),
    ).toThrow()
  })

  test('keeps unavailable state mode-specific and pagination-bounded', () => {
    expect(
      parseLeaderboardOutput({
        status: 'unavailable',
        reason: 'not_yet_published',
        mode: '3v3',
        page: 1,
        pageSize: 20,
      }),
    ).toEqual({ status: 'unavailable', reason: 'not_yet_published', mode: '3v3', page: 1, pageSize: 20 })
  })
})
