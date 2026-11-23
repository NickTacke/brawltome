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

const loadedAt = '2026-11-23T12:00:00.000Z'

const render = (esports: EsportsProfile) =>
  renderToStaticMarkup(<EsportsSection esports={esports} loadedAt={loadedAt} />)

const daySeconds = 24 * 60 * 60
const loadedAtSeconds = Date.parse(loadedAt) / 1000

// the event's name doubles as its heading, so a tile's label reads "3rd at <name>"
function finish(name: string, placement: number, daysAgo: number, mode: EsportsResult['mode'] = '1v1') {
  const startTime = loadedAtSeconds - daysAgo * daySeconds

  return result({ id: `${mode}-${name}`, tournamentId: name, mode, placement, heading: name, title: name, startTime })
}

// the profile lists results newest first, as the server sends them
function newestFirst(results: EsportsResult[]): EsportsResult[] {
  return results.toSorted((left, right) => right.startTime - left.startTime)
}

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

  // the cards are the first grid of tiles, the rest follow in their own
  function cardNames(): string[] {
    const cardGrid = container.querySelector('[data-tiles]')
    const cards = [...(cardGrid?.querySelectorAll('[data-tile]') ?? [])]

    return cards.map((card) => card.getAttribute('aria-label')?.split(' at ')[1] ?? '')
  }

  async function renderResults(results: EsportsResult[]) {
    const esports = profile({ results: newestFirst(results) })

    await act(async () => root.render(<EsportsSection esports={esports} loadedAt={loadedAt} />))
  }

  async function click(element: Element | null | undefined, description: string) {
    if (!(element instanceof HTMLElement)) throw new Error(`click ${description}: it is not on the page`)

    await act(async () => element.click())
  }

  test('a result with no sets does not open', async () => {
    await act(async () =>
      root.render(<EsportsSection esports={profile({ results: [unplayed] })} loadedAt={loadedAt} />),
    )

    const tile = container.querySelector('[aria-label="1st at BCX 2026"]')

    if (!(tile instanceof HTMLElement)) throw new Error('no tile for the result')

    await act(async () => tile.click())

    expect(container.querySelector('[data-tile-detail]') === null).toBe(true)
    expect(tile.hasAttribute('aria-expanded')).toBe(false)
  })

  test('old 1sts lose to top 8s from the last year', async () => {
    await renderResults([
      finish('old-first', 1, 500),
      finish('older-first', 1, 900),
      finish('eighth', 8, 20),
      finish('fifth', 5, 40),
      finish('seventh', 7, 60),
      finish('third', 3, 300),
    ])

    expect(cardNames()).toEqual(['third', 'fifth', 'seventh', 'eighth'])
    expect(container.querySelector('[aria-label="1st at old-first"]') === null).toBe(false)
  })

  test('fewer than four recent top 8s are followed by the newest older top 8s', async () => {
    await renderResults([
      finish('recent-eighth', 8, 100),
      finish('recent-fifth', 5, 10),
      finish('old-ninth', 9, 380),
      finish('old-second', 2, 400),
      finish('old-third', 3, 500),
      finish('old-first', 1, 900),
    ])

    expect(cardNames()).toEqual(['recent-fifth', 'recent-eighth', 'old-second', 'old-third'])
  })

  test('with nothing in the last year the newest top 8s lead', async () => {
    await renderResults([
      finish('tenth', 10, 370),
      finish('fourth', 4, 400),
      finish('sixth', 6, 450),
      finish('second', 2, 700),
      finish('seventh', 7, 800),
      finish('first', 1, 1000),
    ])

    expect(cardNames()).toEqual(['fourth', 'sixth', 'second', 'seventh'])
  })

  test('a finish exactly 365 days ago still counts as recent', async () => {
    const justOutside = { ...finish('outside-first', 1, 365), startTime: loadedAtSeconds - 365 * daySeconds - 1 }

    await renderResults([justOutside, finish('edge-sixth', 6, 365), finish('recent-eighth', 8, 10)])

    // counted as older, the edge finish would trail the recent 8th
    expect(cardNames()).toEqual(['edge-sixth', 'recent-eighth', 'outside-first'])
  })

  test('the mode filter picks the cards from its own results', async () => {
    await renderResults([
      finish('solo-first', 1, 10),
      finish('solo-second', 2, 20),
      finish('duo-ninth', 9, 5, '2v2'),
      finish('duo-fifth', 5, 30, '2v2'),
      finish('duo-old-third', 3, 400, '2v2'),
      finish('duo-old-first', 1, 600, '2v2'),
      finish('duo-old-second', 2, 800, '2v2'),
    ])

    expect(cardNames()).toEqual(['solo-first', 'solo-second', 'duo-fifth', 'duo-old-third'])

    await click(container.querySelector('[aria-label="Mode: All"]'), 'the mode filter')

    const duoOption = [...container.querySelectorAll('button')].find((button) => button.textContent === '2v2')

    await click(duoOption, 'the 2v2 option')

    expect(cardNames()).toEqual(['duo-fifth', 'duo-old-third', 'duo-old-first', 'duo-old-second'])
  })
})
