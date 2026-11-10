import type { LeaderboardRecentActivityOutput, LeaderboardRecentMoversOutput } from '@brawltome/contracts'

const observedAt = '2026-11-09T12:00:00.000Z'

export function activityEntry(brawlhallaId: number, ratingDelta = 12) {
  return {
    standing: brawlhallaId,
    region: 'EU' as const,
    rating: 2_400 - brawlhallaId,
    ratingDelta,
    winsDelta: 2,
    lossesDelta: 1,
    gamesDelta: 3,
    identity: { type: 'one-vs-one-player' as const, player: { brawlhallaId, name: `Player${brawlhallaId}` } },
  }
}

export function activityView(entryCount: number): Extract<LeaderboardRecentActivityOutput, { status: 'fresh' }> {
  return {
    status: 'fresh',
    mode: '1v1',
    region: 'EU',
    currentSnapshotId: '00000000-0000-4000-8000-000000000001',
    previousObservedAt: observedAt,
    currentObservedAt: observedAt,
    publishedAt: observedAt,
    expectedNextPublicationAt: observedAt,
    provenance: { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 },
    page: 1,
    pageSize: 30,
    hasMore: false,
    totalRows: entryCount,
    entries: Array.from({ length: entryCount }, (_, index) => activityEntry(index + 1)),
  }
}

export function unavailableView(reason: 'not_enough_history' | 'scan_gap'): LeaderboardRecentActivityOutput {
  return { status: 'unavailable', reason, mode: '1v1', region: 'EU', page: 1, pageSize: 30 }
}

export function moversView(): Extract<LeaderboardRecentMoversOutput, { status: 'available' }> {
  return {
    status: 'available',
    mode: '1v1',
    region: 'EU',
    currentSnapshotId: '00000000-0000-4000-8000-000000000001',
    climbers: [activityEntry(1, 30)],
    drops: [activityEntry(2, -20)],
    mostGames: [activityEntry(3)],
  }
}
