import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { countPageView } from '../../server/visits'
import { isMeasuringAllowed, isReloadNavigation, randomVisitId, referrerDomainOf } from './browser-visit'
import { createPageViewCounter, type PageViewCounter, watchPageViews } from './page-view-counter'
import { createVisitSender } from './visit-sender'

// one per tab and only in its memory, so a visit id is never stored on the device; null when we may not count
let tabCounter: PageViewCounter | null | undefined

function createTabCounter(): PageViewCounter | null {
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean }

  const privacy = {
    doNotTrack: browser.doNotTrack,
    globalPrivacyControl: browser.globalPrivacyControl,
    webdriver: browser.webdriver,
  }

  if (!isMeasuringAllowed(privacy)) return null

  const send = createVisitSender({
    visitId: randomVisitId(),
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
