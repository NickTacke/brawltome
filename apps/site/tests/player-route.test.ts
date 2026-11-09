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

mock.module('../src/server/players', () => ({ getPlayer, getIsUnarmedExcluded: async () => true, refreshPlayer }))

type RouteOptions = {
  loader: (context: { params: { id: string } }) => Promise<unknown>
  head: (context: { loaderData?: { player: { name: string } }; match: { status: string } }) => {
    meta: Array<{ title: string }>
  }
  errorComponent: unknown
  notFoundComponent: unknown
}

let options: RouteOptions

function failureOf(id: string): Promise<unknown> {
  return options.loader({ params: { id } }).catch((failure: unknown) => failure)
}

function titleOf(context: Parameters<RouteOptions['head']>[0]): string {
  return options.head(context).meta[0].title
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

  test('an unknown player is not found', async () => {
    getPlayer.mockImplementation(async () => null)

    expect(isNotFound(await failureOf('7'))).toBe(true)
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

  test('returns the page and the remembered unarmed choice', async () => {
    expect(await options.loader({ params: { id: '7' } })).toEqual({ ...page, isUnarmedExcluded: true })
  })

  test('titles follow the load outcome', () => {
    expect(titleOf({ loaderData: { player: { name: 'Seven' } }, match: { status: 'success' } })).toBe(
      'Seven | BrawlTome',
    )

    expect(titleOf({ match: { status: 'notFound' } })).toBe('Player not found | BrawlTome')
    expect(titleOf({ match: { status: 'error' } })).toBe('Player unavailable | BrawlTome')
  })
})
