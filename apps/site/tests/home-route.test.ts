import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'

const getTopPlayers = mock(async (_query: { data: unknown }) => ({ region: 'EU', entries: [] }))
const getTopGuilds = mock(async () => [])
const getPatches = mock(async (): Promise<unknown[] | null> => null)
const getMostPlayedLegends = mock(async () => [])

mock.module('../src/server/home', () => ({ getTopPlayers, getTopGuilds, getPatches, getMostPlayedLegends }))

type Search = { mode?: string; region?: string }

type RouteOptions = {
  validateSearch: (search: Record<string, unknown>) => Search
  loaderDeps: (context: { search: Search }) => Search
  loader: (context: { deps: Search }) => Promise<{ patches: unknown; mostPlayedLegends: unknown }>
}

let options: RouteOptions

function load(search: Record<string, unknown>) {
  const validSearch = options.validateSearch(search)

  return options.loader({ deps: options.loaderDeps({ search: validSearch }) })
}

beforeAll(async () => {
  const { Route } = await import('../src/routes/index')

  options = Route.options as unknown as RouteOptions
})

afterEach(() => {
  getTopPlayers.mockClear()
})

describe('home route', () => {
  test('keeps a known bracket and region from the address', () => {
    expect(options.validateSearch({ mode: '2v2', region: 'BRZ' })).toEqual({ mode: '2v2', region: 'BRZ' })
  })

  test('drops an unknown bracket and region, so the defaults apply', () => {
    expect(options.validateSearch({ mode: '9v9', region: 'Mars' })).toEqual({ mode: undefined, region: undefined })
  })

  test('without a region in the address, the server picks the remembered one', async () => {
    await load({})

    expect(getTopPlayers).toHaveBeenCalledWith({ data: { mode: '1v1', region: undefined } })
  })

  test('asks for the board in the address', async () => {
    await load({ mode: 'solo2v2', region: 'SEA' })

    expect(getTopPlayers).toHaveBeenCalledWith({ data: { mode: 'solo2v2', region: 'SEA' } })
  })

  test('a failed patches feed still loads the page', async () => {
    const page = await load({})

    expect(page.patches).toBeNull()
  })

  test('loads the most played legends with the page', async () => {
    const page = await load({})

    expect(getMostPlayedLegends).toHaveBeenCalled()
    expect(page.mostPlayedLegends).toEqual([])
  })
})
