import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { countPageView } from '../../server/visits'
import { isReloadNavigation, referrerDomainOf } from './browser-visit'
import { createPageViewCounter, type PageViewCounter, watchPageViews } from './page-view-counter'
import { tabVisitIdOrNull } from './tab-visit-id'
import { createVisitSender } from './visit-sender'

// one per tab; null when we may not count
let tabCounter: PageViewCounter | null | undefined

function createTabCounter(): PageViewCounter | null {
  const visitId = tabVisitIdOrNull()

  if (visitId === null) return null

  const send = createVisitSender({
    visitId,
    viewportWidth: () => window.innerWidth,
    referrerDomain: referrerDomainOf(document.referrer, window.location.hostname),
    countPageView: (visit) => countPageView({ data: visit }),
  })

  const navigations = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  const isReload = isReloadNavigation(navigations)

  return createPageViewCounter({ isReload, send })
}

function tabCounterOrNull(): PageViewCounter | null {
  if (tabCounter !== undefined) return tabCounter

  try {
    tabCounter = createTabCounter()
  } catch {
    tabCounter = null
  }

  return tabCounter
}

/** Counts one page view for each page the tab shows. Effects never run in the server render. */
export function useVisitCounting(): void {
  const router = useRouter()

  useEffect(() => {
    const counter = tabCounterOrNull()

    if (!counter) return

    return watchPageViews(router, counter)
  }, [router])
}
