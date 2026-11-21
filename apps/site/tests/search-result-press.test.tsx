import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DiscoveryClanHitContract, DiscoveryPlayerHitContract } from '@brawltome/contracts'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SearchResultList } from '../src/components/search/SearchResultList'
import type { ResultView } from '../src/components/search/use-result-view'

// safari never focuses a tapped link, so a press that moved focus would close the search before the click

const player: DiscoveryPlayerHitContract = {
  brawlhallaId: 9,
  name: 'Ada',
  region: 'EU',
  rating: 2000,
  viewCount: 0,
  bestLegendNameKey: null,
  matchedAlias: null,
}

const guild: DiscoveryClanHitContract = { clanId: 4, clanName: 'Adas', clanXp: '1000', memberCount: 3 }

const ignore = () => undefined

const view: ResultView = {
  players: [player],
  guilds: [guild],
  activeIndex: -1,
  highlighted: undefined,
  hiddenPlayerCount: 0,
  nextBatchCount: 0,
  guildCount: 1,
  isGuildListOpen: true,
  move: ignore,
  showMore: ignore,
  toggleGuilds: ignore,
}

// true when the press was cancelled, which keeps the cursor in the search field
function pressKeepsFieldFocus(element: Element): boolean {
  const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

  element.dispatchEvent(press)

  return press.defaultPrevented
}

describe('pressing a search result', () => {
  let root: Root
  let container: HTMLElement

  beforeAll(async () => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const rootRoute = createRootRoute({
      component: () => <SearchResultList view={view} query="ada" onOpen={ignore} />,
    })

    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })

    await router.load()
    await act(async () => root.render(<RouterProvider router={router} />))
  })

  afterAll(async () => {
    act(() => root.unmount())
    await GlobalRegistrator.unregister()
  })

  test('keeps the field focused on a player row', () => {
    const playerLink = container.querySelector('a[href="/player/9"]')

    expect(playerLink).not.toBeNull()
    expect(pressKeepsFieldFocus(playerLink as Element)).toBe(true)
  })

  test('keeps the field focused on a guild row', () => {
    const guildLink = container.querySelector('a[href="/guild/4"]')

    expect(guildLink).not.toBeNull()
    expect(pressKeepsFieldFocus(guildLink as Element)).toBe(true)
  })
})
