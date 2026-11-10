import { useEffect } from 'react'
import { countSiteEvent } from '../../server/visits'
import { tabVisitIdOrNull } from '../visits/tab-visit-id'
import { watchWebVitals } from './watch-web-vitals'
import { createWebVitalsReporter, type WebVitalsReporter } from './web-vitals-reporter'

// the library keeps watching for as long as the tab lives, so it is started once however often the effect runs
let isWatching = false

// CLS and INP are reported as the tab is hidden or closed, and a plain request can be cancelled with the page
function fetchOutlivingThePage(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, keepalive: true })
}

function tabWebVitalsReporter(): WebVitalsReporter | null {
  const visitId = tabVisitIdOrNull()

  if (visitId === null) return null

  return createWebVitalsReporter({
    visitId,
    // the effect runs before the visitor can follow a link
    landingPath: window.location.pathname,
    currentPath: () => window.location.pathname,
    viewportWidth: () => window.innerWidth,
    countSiteEvent: (event) => countSiteEvent({ data: event, fetch: fetchOutlivingThePage }),
  })
}

// a chunk of its own, fetched once the page is on screen and usable, so measuring never delays what it measures
function startWatching(): void {
  try {
    void watchWebVitals(tabWebVitalsReporter(), () => import('web-vitals'))
  } catch {
    // measuring is never worth an error on the page
  }
}

/** Measures the page's loading speed for the dashboards. Effects never run in the server render. */
export function useWebVitals(): void {
  useEffect(() => {
    if (isWatching) return

    isWatching = true

    startWatching()
  }, [])
}
