import { describe, expect, test } from 'bun:test'
import {
  leaderboardInputSchema,
  leaderboardOutputSchema,
  leaderboardRecentActivityOutputSchema,
  parseLeaderboardOutput,
  parseLeaderboardRecentActivityOutput,
} from '../src/leaderboard'

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

const activityBase = {
  status: 'fresh' as const,
  mode: '1v1' as const,
  region: 'all' as const,
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

  test('round-trips official same-account couch teams as distinct slots', () => {
    const output = {
      ...common,
      mode: '2v2' as const,
      entries: [
        {
          ...entries['2v2'][0],
          identity: {
            type: 'fixed-two-vs-two-team' as const,
            players: [
              { brawlhallaId: 42, name: 'Ada' },
              { brawlhallaId: 42, name: 'Ada•2' },
            ] as [{ brawlhallaId: number; name: string }, { brawlhallaId: number; name: string }],
          },
        },
      ],
    }
    expect(parseLeaderboardOutput(output)).toEqual(output)
  })

  test('round-trips strict mode-specific identities across compatible V1 contract versions', () => {
    for (const contractVersion of [1, 2] as const) {
      for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
        const output = {
          ...common,
          mode,
          provenance: { ...common.provenance, contractVersion },
          entries: entries[mode],
        }
        const parsed = parseLeaderboardOutput(output)
        expect(parsed.mode).toBe(mode)
        expect(parsed).toEqual(output as never)
      }
    }
  })

  test('round-trips disclosed legacy provenance without presenting it as V1 collection', () => {
    const output = {
      ...common,
      status: 'stale' as const,
      mode: '1v1' as const,
      provenance: {
        source: 'v2-legacy' as const,
        contractVersion: 1 as const,
        sourceChecksum: 'a'.repeat(64),
        importedAt: '2026-08-10T12:00:00Z',
        completeness: 'frozen-repository-rows' as const,
      },
      entries: entries['1v1'],
    }
    expect(parseLeaderboardOutput(output)).toEqual(output)
    expect(() =>
      leaderboardOutputSchema.parse({
        ...output,
        provenance: { ...output.provenance, sourceChecksum: 'invalid' },
      }),
    ).toThrow()
  })

  test('cannot deserialize one mode identity as another', () => {
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: 'solo2v2', entries: entries['1v1'] })).toThrow()
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: '3v3', entries: entries['2v2'] })).toThrow()
    expect(() => leaderboardOutputSchema.parse({ ...common, mode: '2v2', entries: entries.solo2v2 })).toThrow()
  })

  test('rejects zero IDs, descending or duplicate fixed slots, inconsistent games, and unknown output fields', () => {
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

describe('recent leaderboard activity contract', () => {
  const playerEntry = {
    ...activityMetrics,
    identity: { type: 'one-vs-one-player' as const, player },
  }
  const fixedTeamEntry = {
    ...activityMetrics,
    ratingDelta: 12,
    identity: {
      type: 'fixed-two-vs-two-team' as const,
      players: [player, { brawlhallaId: 43, name: 'Bodvar' }] as [
        { brawlhallaId: number; name: string },
        { brawlhallaId: number; name: string },
      ],
    },
  }

  test('accepts strict available player, fixed-team, stale, and empty activity', () => {
    const oneVsOne = { ...activityBase, entries: [playerEntry] }
    expect(parseLeaderboardRecentActivityOutput(oneVsOne)).toEqual(oneVsOne)

    const fixedTeam = { ...activityBase, mode: '2v2' as const, entries: [fixedTeamEntry] }
    expect(parseLeaderboardRecentActivityOutput(fixedTeam)).toEqual(fixedTeam)

    for (const [mode, identity] of [
      ['solo2v2', { type: 'solo-two-vs-two-player', player }],
      ['3v3', { type: 'three-vs-three-player', player }],
    ] as const) {
      const output = {
        ...activityBase,
        status: 'stale' as const,
        mode,
        totalRows: 1,
        entries: [{ ...activityMetrics, identity }],
      }
      expect(parseLeaderboardRecentActivityOutput(output)).toEqual(output as never)
    }

    const empty = { ...activityBase, totalRows: 0, entries: [] }
    expect(parseLeaderboardRecentActivityOutput(empty)).toEqual(empty)
  })

  test('accepts unavailable reasons and rejects invalid or presence-shaped activity', () => {
    for (const reason of ['not_enough_history', 'scan_gap'] as const) {
      const unavailable = {
        status: 'unavailable' as const,
        reason,
        mode: '1v1' as const,
        region: 'all' as const,
        page: 1,
        pageSize: 20,
      }
      expect(parseLeaderboardRecentActivityOutput(unavailable)).toEqual(unavailable)
    }

    for (const entry of [
      { ...playerEntry, gamesDelta: 0, winsDelta: 0, lossesDelta: 0 },
      { ...playerEntry, winsDelta: -1, lossesDelta: 4 },
      { ...playerEntry, lossesDelta: -1, winsDelta: 4 },
      { ...playerEntry, gamesDelta: -3 },
      { ...playerEntry, gamesDelta: 4 },
      { ...playerEntry, online: true },
    ]) {
      expect(() => leaderboardRecentActivityOutputSchema.parse({ ...activityBase, entries: [entry] })).toThrow()
    }
    expect(() =>
      leaderboardRecentActivityOutputSchema.parse({
        ...activityBase,
        mode: '2v2',
        entries: [
          {
            ...fixedTeamEntry,
            identity: { ...fixedTeamEntry.identity, players: [player, player] },
          },
        ],
      }),
    ).toThrow()
  })
})
