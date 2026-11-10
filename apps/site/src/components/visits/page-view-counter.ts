import type { AnyRouter } from '@tanstack/react-router'

type PageViewCounterOptions = {
  // the tab was opened by reloading, so its first page was already counted before
  isReload: boolean
  send: (path: string, isFirstView: boolean) => void
}

export type PageViewCounter = ReturnType<typeof createPageViewCounter>

/**
 * Counts a view each time the tab shows a different page. Search changes, live refresh reloads of the same page and
 * repeated calls for one page are not new views.
 */
export function createPageViewCounter({ isReload, send }: PageViewCounterOptions) {
  let lastPath: string | undefined

  function observe(path: string): void {
    if (path === lastPath) return

    const isFirstView = lastPath === undefined

    lastPath = path

    if (isFirstView && isReload) return

    send(path, isFirstView)
  }

  return { observe }
}

/**
 * Feeds the counter the page on screen, then every page a navigation finishes on. Preloads never finish a navigation,
 * and a loader reload finishes on the page already counted.
 */
export function watchPageViews(router: AnyRouter, counter: PageViewCounter): () => void {
  counter.observe(router.state.location.pathname)

  return router.subscribe('onResolved', (event) => counter.observe(event.toLocation.pathname))
}
