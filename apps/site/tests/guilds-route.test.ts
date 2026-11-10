import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { rankedClanListInputSchema } from '@brawltome/contracts'
import { lastGuildRankingPage } from '../src/components/guilds/guild-ranking-search'

const getGuildRanking = mock(async (_query: { data: unknown }) => null)

mock.module('../src/server/guild-ranking', () => ({ getGuildRanking }))

type Search = { page?: number }

type RouteOptions = {
  validateSearch: (search: Record<string, unknown>) => Search
  loaderDeps: (context: { search: Search }) => { page: number }
  loader: (context: { deps: { page: number } }) => Promise<unknown>
  head: () => { meta: Array<{ title: string }> }
}

let options: RouteOptions

function load(search: Record<string, unknown>) {
  const validSearch = options.validateSearch(search)

  return options.loader({ deps: options.loaderDeps({ search: validSearch }) })
}

beforeAll(async () => {
  const { Route } = await import('../src/routes/guilds')

  options = Route.options as unknown as RouteOptions
})

afterEach(() => {
  getGuildRanking.mockClear()
})

describe('guilds route', () => {
  test('titles the page', () => {
    expect(options.head().meta[0]?.title).toBe('Guilds | BrawlTome')
  })

  test('keeps the page from the address', () => {
    expect(options.validateSearch({ page: 12 })).toEqual({ page: 12 })
  })

  test('leaves the first page and a broken one out of the address', () => {
    expect(options.validateSearch({ page: 1 })).toEqual({ page: undefined })
    expect(options.validateSearch({ page: 'x' })).toEqual({ page: undefined })
  })

  test('starts on the first page', async () => {
    await load({})

    expect(getGuildRanking).toHaveBeenCalledWith({ data: 1 })
  })

  test('asks for the page in the address', async () => {
    await load({ page: 3 })

    expect(getGuildRanking).toHaveBeenCalledWith({ data: 3 })
  })

  test('a failed read still loads the page', async () => {
    expect(await load({})).toBeNull()
  })
})

describe('lastGuildRankingPage', () => {
  test('matches the last page the api accepts', () => {
    expect(lastGuildRankingPage).toBe(rankedClanListInputSchema.shape.page.maxValue as number)
  })
})
