import { describe, expect, test } from 'bun:test'
import { loadTopGuilds } from '../src/server/load-top-guilds'
import { stubFetch, useApiSettings } from './api-stub'

function guild(rank: number) {
  return {
    rank,
    clanId: rank * 10,
    clanName: `Guild${rank}`,
    guildPoints: String(10_000 - rank),
    lifetimeXp: '5000000',
    memberCount: 100,
  }
}

function page(entryCount: number) {
  return {
    page: 1,
    pageSize: 30,
    hasMore: false,
    totalRows: entryCount,
    entries: Array.from({ length: entryCount }, (_, index) => guild(index + 1)),
  }
}

describe('loadTopGuilds', () => {
  useApiSettings()

  test('reads the first page of ranked guilds', async () => {
    const urls = stubFetch(() => ({ status: 200, body: page(30) }))

    await loadTopGuilds()

    expect(urls).toEqual(['/clans?page=1'])
  })

  test('keeps the top five in the order the api gave', async () => {
    stubFetch(() => ({ status: 200, body: page(30) }))

    const guilds = await loadTopGuilds()

    expect(guilds?.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5])
  })

  test('no ranked guilds is empty, not a failure', async () => {
    stubFetch(() => ({ status: 200, body: page(0) }))

    expect(await loadTopGuilds()).toEqual([])
  })

  test('a failed read is null, so the page can still show', async () => {
    stubFetch(() => ({ status: 500, body: {} }))

    expect(await loadTopGuilds()).toBeNull()
  })
})
