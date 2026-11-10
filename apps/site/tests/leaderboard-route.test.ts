import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { leaderboardPageInputSchema } from '@brawltome/contracts'
import { lastLeaderboardPage } from '../src/components/leaderboard/leaderboard-search'

const getLeaderboardPage = mock(async (_query: { data: unknown }) => ({ region: 'EU', board: null }))

mock.module('../src/server/leaderboard', () => ({ getLeaderboardPage }))

type Search = { mode?: string; region?: string; page?: number }

type RouteOptions = {
  validateSearch: (search: Record<string, unknown>) => Search
  loaderDeps: (context: { search: Search }) => Search
  loader: (context: { deps: Search }) => Promise<{ board: unknown }>
  head: () => { meta: Array<{ title: string }> }
}

let options: RouteOptions

function load(search: Record<string, unknown>) {
  const validSearch = options.validateSearch(search)

  return options.loader({ deps: options.loaderDeps({ search: validSearch }) })
}

beforeAll(async () => {
  const { Route } = await import('../src/routes/leaderboard')

  options = Route.options as unknown as RouteOptions
})

afterEach(() => {
  getLeaderboardPage.mockClear()
})

describe('leaderboard route', () => {
  test('titles the page', () => {
    expect(options.head().meta[0]?.title).toBe('Leaderboard | BrawlTome')
  })

  test('keeps a known bracket, region and page from the address', () => {
    expect(options.validateSearch({ mode: '2v2', region: 'BRZ', page: 4 })).toEqual({
      mode: '2v2',
      region: 'BRZ',
      page: 4,
    })
  })

  test('leaves the defaults out of the address', () => {
    expect(options.validateSearch({ mode: '1v1', page: 1 })).toEqual({
      mode: undefined,
      region: undefined,
      page: undefined,
    })
  })

  test('drops an unknown bracket, region and page', () => {
    expect(options.validateSearch({ mode: '9v9', region: 'Mars', page: 'two' })).toEqual({
      mode: undefined,
      region: undefined,
      page: undefined,
    })
  })

  test('without a region in the address, the server picks the remembered one', async () => {
    await load({})

    expect(getLeaderboardPage).toHaveBeenCalledWith({ data: { mode: '1v1', region: undefined, page: 1 } })
  })

  test('asks for the board and page in the address', async () => {
    await load({ mode: 'solo2v2', region: 'SEA', page: 7 })

    expect(getLeaderboardPage).toHaveBeenCalledWith({ data: { mode: 'solo2v2', region: 'SEA', page: 7 } })
  })

  test('a page past the last one the api serves asks for the last one', async () => {
    await load({ page: 100_000 })

    expect(getLeaderboardPage).toHaveBeenCalledWith({ data: { mode: '1v1', region: undefined, page: 500 } })
  })
})

describe('lastLeaderboardPage', () => {
  test('matches the last page the api accepts', () => {
    expect(lastLeaderboardPage).toBe(leaderboardPageInputSchema.shape.page.maxValue as number)
  })
})
