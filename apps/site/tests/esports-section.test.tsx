import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { EsportsSection } from '../src/components/player/esports/EsportsSection'
import type { EsportsResult, EsportsSet } from '../src/components/player/esports/esports-format'
import { ResultCard } from '../src/components/player/esports/ResultCard'
import { PlayerPage } from '../src/components/player/PlayerPage'
import type { EsportsProfile, PlayerPage as PlayerPageData } from '../src/server/load-player'

const playedSet: EsportsSet = {
  id: 'set-1',
  isWin: true,
  isForfeit: false,
  score: '3-1',
  opponents: [{ brawlhallaId: 42, name: 'Rival' }],
  legendKey: null,
  opponentLegendKey: null,
}

function result(overrides: Partial<EsportsResult> = {}): EsportsResult {
  return {
    id: '1v1-100',
    tournamentId: '100',
    mode: '1v1',
    placement: 1,
    fullName: 'Brawlhalla Championship Expo 2026',
    heading: 'BCX 2026',
    title: 'BCX',
    meta: '2026',
    startTime: 1_794_700_800,
    isOfficial: true,
    isOnline: false,
    legendKey: null,
    sets: [playedSet],
    setRecord: { wins: 1, losses: 0 },
    ...overrides,
  }
}

const unplayed = result({ id: '1v1-200', tournamentId: '200', title: 'Dark Harvest', sets: [], setRecord: null })

function profile(overrides: Partial<EsportsProfile> = {}): EsportsProfile {
  return {
    earnings: 90_900,
    rankings: [
      { mode: '1v1', rank: 1, region: 'NA', gold: 3, silver: 1, bronze: 0, top8: 9 },
      { mode: '2v2', rank: 2, region: 'NA', gold: 1, silver: 0, bronze: 1, top8: 5 },
    ],
    results: [result(), result({ id: '2v2-300', tournamentId: '300', mode: '2v2', title: 'Summer Champs' })],
    ...overrides,
  }
}

const render = (esports: EsportsProfile) => renderToStaticMarkup(<EsportsSection esports={esports} />)

const page: PlayerPageData = {
  player: {
    brawlhallaId: 7,
    name: 'Seven',
    aliases: [],
    clan: null,
    bestLegendNameKey: null,
    currentSeason: null,
    career: null,
    esports: null,
  },
  seasonStarts: [],
  loadedAt: '2026-11-09T12:00:00.000Z',
}

// the pin button under the name is a link for a signed out visitor, so the page renders inside a small router
async function renderPlayerPage(esports: EsportsProfile | null): Promise<string> {
  const player = { ...page.player, esports }
  const refresh = { status: 'idle' as const, onRetry: () => {} }
  const element = <PlayerPage {...page} player={player} isUnarmedExcluded={false} refresh={refresh} />
  const rootRoute = createRootRoute({ component: () => element })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/player/7'] }) })

  await router.load()

  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('esports section', () => {
  test('renders nothing when esports is null', async () => {
    const without = await renderPlayerPage(null)
    const withResults = await renderPlayerPage(profile())

    expect(without).not.toContain('aria-labelledby="esports"')
    expect(withResults).toContain('aria-labelledby="esports"')
  })

  test('headline leaves out a mode without pr and earnings when null', () => {
    const rankings = [{ mode: '1v1' as const, rank: 4, region: 'EU', gold: 0, silver: 0, bronze: 0, top8: 2 }]
    const html = render(profile({ earnings: null, rankings, results: [result()] }))

    expect(html).toContain('PR 4')
    expect(html).toContain('EU 1v1')
    expect(html).not.toContain('2v2')
    expect(html).not.toContain('earned')
  })

  test('the headline shows both power rankings and the earnings', () => {
    const html = render(profile())

    expect(html).toContain('PR 1')
    expect(html).toContain('PR 2')
    expect(html).toContain('$90.9K')
  })

  test('no mode filter when only one mode has results', () => {
    const oneMode = render(profile({ results: [result(), unplayed] }))
    const bothModes = render(profile())

    expect(oneMode).not.toContain('Mode:')
    expect(bothModes).toContain('Mode: All')
  })

  test('a result with no sets has no set record in its card', () => {
    const withSets = renderToStaticMarkup(<ResultCard result={result()} />)
    const withoutSets = renderToStaticMarkup(<ResultCard result={unplayed} />)

    expect(withSets).toContain('1-0')
    expect(withoutSets).not.toContain('Sets')
  })

  test('the headline stays in the document while the section is collapsed', () => {
    const html = render(profile())
    const bodyAt = html.indexOf('data-collapse-body')

    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('PR 1')).toBeGreaterThan(-1)
    expect(html.indexOf('PR 1')).toBeLessThan(bodyAt)
    expect(html.indexOf('$90.9K')).toBeLessThan(bodyAt)
  })
})

describe('esports tiles', () => {
  let root: Root
  let container: HTMLElement

  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test('a result with no sets does not open', async () => {
    await act(async () => root.render(<EsportsSection esports={profile({ results: [unplayed] })} />))

    const tile = container.querySelector('[aria-label="1st at BCX 2026"]')

    if (!(tile instanceof HTMLElement)) throw new Error('no tile for the result')

    await act(async () => tile.click())

    expect(container.querySelector('[data-tile-detail]') === null).toBe(true)
    expect(tile.hasAttribute('aria-expanded')).toBe(false)
  })
})
