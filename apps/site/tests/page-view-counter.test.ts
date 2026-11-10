import { describe, expect, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { createPageViewCounter, watchPageViews } from '../src/components/visits/page-view-counter'

type View = { path: string; isFirstView: boolean }

function counterRecording({ isReload = false } = {}) {
  const views: View[] = []
  const counter = createPageViewCounter({ isReload, send: (path, isFirstView) => views.push({ path, isFirstView }) })

  return { views, counter }
}

// a router like the site's, with loaders, driven without a page
function createTestRouter() {
  const rootRoute = createRootRoute()
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/', loader: () => 'home' })
  const player = createRoute({ getParentRoute: () => rootRoute, path: '/player/$id', loader: () => 'player' })
  const routeTree = rootRoute.addChildren([home, player])

  return createRouter({ routeTree, history: createMemoryHistory(), isServer: false, origin: 'http://site.test' })
}

describe('page view counter', () => {
  test('counts the first page once, as the first view', () => {
    const { views, counter } = counterRecording()

    counter.observe('/')
    counter.observe('/')

    expect(views).toEqual([{ path: '/', isFirstView: true }])
  })

  test('counts each new page', () => {
    const { views, counter } = counterRecording()

    counter.observe('/')
    counter.observe('/player/7')
    counter.observe('/')

    expect(views.map((view) => view.path)).toEqual(['/', '/player/7', '/'])
    expect(views.map((view) => view.isFirstView)).toEqual([true, false, false])
  })

  test('a reload of the page is not a new view, the next page is', () => {
    const { views, counter } = counterRecording({ isReload: true })

    counter.observe('/player/7')
    counter.observe('/queue')

    expect(views).toEqual([{ path: '/queue', isFirstView: false }])
  })
})

describe('watching the router for page views', () => {
  test('one view per navigation', async () => {
    const router = createTestRouter()
    const { views, counter } = counterRecording()

    await router.load()
    watchPageViews(router, counter)
    await router.navigate({ to: '/player/$id', params: { id: '7' } })
    await router.navigate({ to: '/player/$id', params: { id: '8' } })
    await router.navigate({ to: '/' })

    expect(views.map((view) => view.path)).toEqual(['/', '/player/7', '/player/8', '/'])
  })

  test('no view when live refresh reloads the loaders', async () => {
    const router = createTestRouter()
    const { views, counter } = counterRecording()

    await router.navigate({ to: '/player/$id', params: { id: '7' } })
    watchPageViews(router, counter)
    await router.invalidate()
    await router.invalidate()

    expect(views.map((view) => view.path)).toEqual(['/player/7'])
  })

  test('no view for a page preloaded on hover', async () => {
    const router = createTestRouter()
    const { views, counter } = counterRecording()

    await router.load()
    watchPageViews(router, counter)
    await router.preloadRoute({ to: '/player/$id', params: { id: '7' } })

    expect(views.map((view) => view.path)).toEqual(['/'])
  })

  test('watching twice, as strict mode does with effects, still counts once', async () => {
    const router = createTestRouter()
    const { views, counter } = counterRecording()

    await router.load()
    const stopWatching = watchPageViews(router, counter)

    stopWatching()
    watchPageViews(router, counter)
    await router.navigate({ to: '/player/$id', params: { id: '7' } })

    expect(views.map((view) => view.path)).toEqual(['/', '/player/7'])
  })
})
