import { describe, expect, test } from 'bun:test'
import { loadGuildRanking } from '../src/server/load-guild-ranking'
import { stubFetch, useApiSettings } from './api-stub'
import { guildRankingBody } from './ranking-fixtures'

describe('loadGuildRanking', () => {
  useApiSettings()

  test('reads the chosen page', async () => {
    const urls = stubFetch(() => ({ status: 200, body: guildRankingBody({ page: 4, entryCount: 30, totalRows: 500 }) }))

    await loadGuildRanking(4)

    expect(urls).toEqual(['/clans?page=4'])
  })

  test('keeps every row of the page, with the total for the pager', async () => {
    stubFetch(() => ({ status: 200, body: guildRankingBody({ page: 2, entryCount: 30, totalRows: 500 }) }))

    const ranking = await loadGuildRanking(2)

    expect(ranking?.entries).toHaveLength(30)
    expect(ranking?.entries[0]?.rank).toBe(31)
    expect(ranking).toMatchObject({ totalRows: 500, pageSize: 30 })
  })

  test('a page past the end has no rows but keeps the total', async () => {
    stubFetch(() => ({ status: 200, body: guildRankingBody({ page: 40, entryCount: 0, totalRows: 500 }) }))

    expect(await loadGuildRanking(40)).toEqual({ entries: [], totalRows: 500, pageSize: 30 })
  })

  test('no ranked guilds is empty, not a failure', async () => {
    stubFetch(() => ({ status: 200, body: guildRankingBody({ page: 1, entryCount: 0, totalRows: 0 }) }))

    expect(await loadGuildRanking(1)).toEqual({ entries: [], totalRows: 0, pageSize: 30 })
  })

  test('a failed read is null, so the page can still show', async () => {
    stubFetch(() => ({ status: 500, body: {} }))

    expect(await loadGuildRanking(1)).toBeNull()
  })
})
