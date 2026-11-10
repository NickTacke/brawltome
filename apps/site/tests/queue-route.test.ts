import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { queueQuery, validateQueueSearch } from '../src/components/queue/queue-search'

const getQueue = mock(async (_query: { data: unknown }) => ({ view: null, movers: null }))

mock.module('../src/server/queue', () => ({ getQueue }))

type Search = ReturnType<typeof validateQueueSearch>

type RouteOptions = {
  validateSearch: (search: Record<string, unknown>) => Search
  loaderDeps: (context: { search: Search }) => unknown
  loader: (context: { deps: unknown }) => Promise<unknown>
}

let options: RouteOptions

beforeAll(async () => {
  const { Route } = await import('../src/routes/queue')

  options = Route.options as unknown as RouteOptions
})

describe('validateQueueSearch', () => {
  test('keeps a known bracket, region and page from the address', () => {
    expect(validateQueueSearch({ mode: '2v2', region: 'BRZ', page: 3 })).toEqual({
      mode: '2v2',
      region: 'BRZ',
      page: 3,
    })
  })

  test('leaves the defaults out of the address', () => {
    expect(validateQueueSearch({ mode: '1v1', region: 'all', page: 1 })).toEqual({
      mode: undefined,
      region: undefined,
      page: undefined,
    })
  })

  test.each([0, -2, 1.5, 501, '3', null])('drops page %p', (page) => {
    expect(validateQueueSearch({ page }).page).toBeUndefined()
  })

  test('drops an unknown bracket and region', () => {
    expect(validateQueueSearch({ mode: '9v9', region: 'Mars' })).toEqual({
      mode: undefined,
      region: undefined,
      page: undefined,
    })
  })
})

describe('queueQuery', () => {
  test('fills in the defaults', () => {
    expect(queueQuery({})).toEqual({ mode: '1v1', region: 'all', page: 1 })
  })
})

describe('queue route', () => {
  test('loads the board and page in the address', async () => {
    const search = options.validateSearch({ mode: 'solo2v2', region: 'SEA', page: 2 })

    await options.loader({ deps: options.loaderDeps({ search }) })

    expect(getQueue).toHaveBeenCalledWith({ data: { mode: 'solo2v2', region: 'SEA', page: 2 } })
  })
})
