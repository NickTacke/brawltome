const observedAt = '2026-11-09T12:00:00.000Z'

function leaderboardEntry(standing: number) {
  return {
    standing,
    sourceRank: standing,
    region: 'EU',
    rating: 2500 - standing,
    peakRating: 2600,
    wins: 60,
    losses: 40,
    games: 100,
    tier: 'Diamond',
    identity: { type: 'one-vs-one-player', player: { brawlhallaId: standing, name: `Player${standing}` } },
  }
}

type PageShape = { page: number; entryCount: number; totalRows: number }

/** One page of a 1v1 board as the api answers it, ranked from where the page starts. */
export function leaderboardBody({ page, entryCount, totalRows }: PageShape) {
  const firstStanding = (page - 1) * 30 + 1

  return {
    status: 'fresh',
    mode: '1v1',
    snapshotId: '00000000-0000-4000-8000-000000000001',
    generationId: '00000000-0000-4000-8000-000000000002',
    region: 'EU',
    observedAt,
    publishedAt: observedAt,
    expectedNextPublicationAt: observedAt,
    provenance: { source: 'brawlhalla-v1-ranked-leaderboard', contractVersion: 2, pageDepth: 1 },
    page,
    pageSize: 30,
    hasMore: page * 30 < totalRows,
    totalRows,
    entries: Array.from({ length: entryCount }, (_, index) => leaderboardEntry(firstStanding + index)),
  }
}
