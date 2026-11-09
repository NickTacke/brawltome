import { describe, expect, test } from 'bun:test'
import { loadSearch } from '../src/server/load-search'
import { stubFetch, useApiSettings } from './api-stub'

function player(brawlhallaId: number, rating: number, matchedAlias: string | null = null) {
  return {
    brawlhallaId,
    name: `Player${brawlhallaId}`,
    region: 'EU',
    rating,
    viewCount: 0,
    bestLegendNameKey: null,
    matchedAlias,
  }
}

const clan = { clanId: 9, clanName: 'Valhalla', clanXp: '1000', memberCount: 12 }

describe('loadSearch', () => {
  useApiSettings()

  test('asks the api with the query encoded', async () => {
    const urls = stubFetch(() => ({ status: 200, body: { players: [], clans: [] } }))

    await loadSearch('a&b c')

    expect(urls).toEqual(['/search?query=a%26b%20c'])
  })

  // the api ranks old names below every current name, a re-sort by rating here would undo that
  test('keeps the order the api ranked the players in', async () => {
    const players = [player(1, 1200), player(2, 2400), player(3, 2800, 'OldName')]

    stubFetch(() => ({ status: 200, body: { players, clans: [clan] } }))

    const results = await loadSearch('pla')

    expect(results.players.map(({ brawlhallaId }) => brawlhallaId)).toEqual([1, 2, 3])
    expect(results.guilds.map(({ clanId }) => clanId)).toEqual([9])
  })

  test('a failed search says so without the api detail', async () => {
    stubFetch(() => ({ status: 503, body: { message: 'database on fire' } }))

    const failure = await loadSearch('pla').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('search failed')
  })
})
