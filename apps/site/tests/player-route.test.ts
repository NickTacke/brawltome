import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { isNotFound } from '@tanstack/react-router'
import type { PlayerPage } from '../src/server/load-player'

const page: PlayerPage = {
  player: {
    brawlhallaId: 7,
    name: 'Seven',
    aliases: [],
    clan: null,
    bestLegendNameKey: null,
    currentSeason: null,
    career: null,
  },
  seasonStarts: [],
  loadedAt: '2026-11-09T12:00:00.000Z',
}

const getPlayer = mock(async (): Promise<PlayerPage | null> => page)

const refreshPlayer = mock(async () => ({ kind: 'fresh' }))
const recordPlayerView = mock(async () => undefined)

mock.module('../src/server/players', () => ({
  getPlayer,
  getIsUnarmedExcluded: async () => true,
  refreshPlayer,
  recordPlayerView,
}))

type LoaderData = { kind: 'player'; player: { name: string } } | { kind: 'lookup'; playerId: number }

type RouteOptions = {
  loader: (context: { params: { id: string } }) => Promise<unknown>
  head: (context: { loaderData?: LoaderData; match: { status: string } }) => {
    meta: Array<{ title?: string; name?: string; content?: string }>
  }
  errorComponent: unknown
  notFoundComponent: unknown
}

let options: RouteOptions

function failureOf(id: string): Promise<unknown> {
  return options.loader({ params: { id } }).catch((failure: unknown) => failure)
}

function titleOf(context: Parameters<RouteOptions['head']>[0]): string {
  return options.head(context).meta[0].title ?? ''
}

beforeAll(async () => {
  const { Route } = await import('../src/routes/player.$id')

  options = Route.options as unknown as RouteOptions
})

afterEach(() => {
  getPlayer.mockClear()
  getPlayer.mockImplementation(async () => page)
})

describe('player route', () => {
  test.each(['abc', '0', '2147483648'])('%p is not found without an api call', async (id) => {
    expect(isNotFound(await failureOf(id))).toBe(true)
    expect(getPlayer).not.toHaveBeenCalled()
  })

  // the browser asks for the lookup once the page is on screen, so a crawler reading random ids costs no refresh
  test('an unknown player is looked up from the page, not from the server render', async () => {
    getPlayer.mockImplementation(async () => null)

    expect(await options.loader({ params: { id: '7' } })).toEqual({ kind: 'lookup', playerId: 7 })
    expect(refreshPlayer).not.toHaveBeenCalled()
  })

  test('a failed load reaches the error component', async () => {
    const failure = new Error('load player 7: the player could not be read')

    getPlayer.mockImplementation(async () => {
      throw failure
    })

    expect(await failureOf('7')).toBe(failure)
    expect(options.errorComponent).toBeDefined()
  })

  // the refresh starts from the page on screen, so a prefetch or a crawler reading the html never asks for one
  test('loading the page never asks for a refresh', async () => {
    const stalePage = { ...page, player: { ...page.player, currentSeason: null } }

    getPlayer.mockImplementation(async () => stalePage)
    await options.loader({ params: { id: '7' } })

    expect(refreshPlayer).not.toHaveBeenCalled()
  })

  // the server's own read is not a visitor, the view is counted from the page once it is on screen
  test('loading the page never counts a view', async () => {
    await options.loader({ params: { id: '7' } })

    expect(recordPlayerView).not.toHaveBeenCalled()
  })

  test('returns the page and the remembered unarmed choice', async () => {
    expect(await options.loader({ params: { id: '7' } })).toEqual({ kind: 'player', ...page, isUnarmedExcluded: true })
  })

  test('titles follow the load outcome', () => {
    const playerData: LoaderData = { kind: 'player', player: { name: 'Seven' } }

    expect(titleOf({ loaderData: playerData, match: { status: 'success' } })).toBe('Seven | BrawlTome')

    expect(titleOf({ loaderData: { kind: 'lookup', playerId: 7 }, match: { status: 'success' } })).toBe(
      'Looking up player 7 | BrawlTome',
    )

    expect(titleOf({ match: { status: 'notFound' } })).toBe('Player not found | BrawlTome')
    expect(titleOf({ match: { status: 'error' } })).toBe('Player unavailable | BrawlTome')
  })

  test('a lookup page is kept out of search results', () => {
    const lookupMeta = options.head({ loaderData: { kind: 'lookup', playerId: 7 }, match: { status: 'success' } }).meta

    const playerMeta = options.head({
      loaderData: { kind: 'player', player: { name: 'Seven' } },
      match: { status: 'success' },
    }).meta

    expect(lookupMeta).toContainEqual({ name: 'robots', content: 'noindex' })
    expect(playerMeta).not.toContainEqual({ name: 'robots', content: 'noindex' })
  })
})
