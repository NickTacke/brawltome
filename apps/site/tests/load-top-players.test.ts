import { describe, expect, test } from 'bun:test'
import { loadTopPlayers } from '../src/server/load-top-players'
import { stubFetch, useApiSettings } from './api-stub'

const observedAt = '2026-11-09T12:00:00.000Z'

function entry(standing: number) {
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

function board(entryCount: number) {
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
    page: 1,
    pageSize: 30,
    hasMore: false,
    totalRows: entryCount,
    entries: Array.from({ length: entryCount }, (_, index) => entry(index + 1)),
  }
}

describe('loadTopPlayers', () => {
  useApiSettings()

  test('reads the first page of the chosen board', async () => {
    const urls = stubFetch(() => ({ status: 200, body: board(30) }))

    await loadTopPlayers('2v2', 'US-E')

    expect(urls).toEqual(['/leaderboards/2v2/US-E?page=1'])
  })

  test('keeps the top five in the order the api gave', async () => {
    stubFetch(() => ({ status: 200, body: board(30) }))

    const players = await loadTopPlayers('1v1', 'EU')

    expect(players?.map(({ standing }) => standing)).toEqual([1, 2, 3, 4, 5])
  })

  test('a board with no rows is empty, not a failure', async () => {
    stubFetch(() => ({ status: 200, body: board(0) }))

    expect(await loadTopPlayers('1v1', 'EU')).toEqual([])
  })

  test('a board that is not published yet is empty', async () => {
    const unpublished = { status: 'unavailable', reason: 'not_yet_published', mode: '3v3', page: 1, pageSize: 30 }

    stubFetch(() => ({ status: 200, body: unpublished }))

    expect(await loadTopPlayers('3v3', 'all')).toEqual([])
  })

  test('a failed read is null, so the page can still show', async () => {
    stubFetch(() => ({ status: 503, body: {} }))

    expect(await loadTopPlayers('1v1', 'EU')).toBeNull()
  })
})
