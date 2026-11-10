import { describe, expect, test } from 'bun:test'
import { loadLeaderboardPage } from '../src/server/load-leaderboard-page'
import { stubFetch, useApiSettings } from './api-stub'
import { leaderboardBody } from './ranking-fixtures'

describe('loadLeaderboardPage', () => {
  useApiSettings()

  test('reads the page of the chosen board', async () => {
    const urls = stubFetch(() => ({ status: 200, body: leaderboardBody({ page: 3, entryCount: 30, totalRows: 200 }) }))

    await loadLeaderboardPage({ mode: '2v2', region: 'US-E', page: 3 })

    expect(urls).toEqual(['/leaderboards/2v2/US-E?page=3'])
  })

  test('keeps every row of the page, with the total for the pager', async () => {
    stubFetch(() => ({ status: 200, body: leaderboardBody({ page: 2, entryCount: 30, totalRows: 200 }) }))

    const board = await loadLeaderboardPage({ mode: '1v1', region: 'EU', page: 2 })

    expect(board?.entries.map(({ standing }) => standing)).toEqual(Array.from({ length: 30 }, (_, index) => 31 + index))
    expect(board).toMatchObject({ totalRows: 200, pageSize: 30 })
  })

  test('a page past the end has no rows but keeps the total', async () => {
    stubFetch(() => ({ status: 200, body: leaderboardBody({ page: 9, entryCount: 0, totalRows: 200 }) }))

    expect(await loadLeaderboardPage({ mode: '1v1', region: 'EU', page: 9 })).toEqual({
      entries: [],
      totalRows: 200,
      pageSize: 30,
    })
  })

  test('a board that is not published yet is empty', async () => {
    const unpublished = { status: 'unavailable', reason: 'not_yet_published', mode: '3v3', page: 1, pageSize: 30 }

    stubFetch(() => ({ status: 200, body: unpublished }))

    expect(await loadLeaderboardPage({ mode: '3v3', region: 'all', page: 1 })).toEqual({
      entries: [],
      totalRows: 0,
      pageSize: 30,
    })
  })

  test('a failed read is null, so the page can still show', async () => {
    stubFetch(() => ({ status: 503, body: {} }))

    expect(await loadLeaderboardPage({ mode: '1v1', region: 'EU', page: 1 })).toBeNull()
  })
})
