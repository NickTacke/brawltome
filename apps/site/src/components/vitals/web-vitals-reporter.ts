import type { SiteEventInputContract } from '@brawltome/contracts'

type WebVitalEvent = Extract<SiteEventInputContract, { name: 'vitals' }>

/** What the web vitals library says about one metric, as far as it is reported. */
export type ReportedWebVital = { name: WebVitalEvent['metric']; value: number; navigationType: string }

type WebVitalsReporterOptions = {
  visitId: string
  // the page the tab loaded on
  landingPath: string
  currentPath: () => string
  viewportWidth: () => number
  countSiteEvent: (event: SiteEventInputContract) => Promise<unknown>
}

export type WebVitalsReporter = ReturnType<typeof createWebVitalsReporter>

// the api refuses anything larger
const largestValue = 600_000
// a page load reports four, more only come when a tab is hidden or brought back again and again
const mostReportsPerTab = 20

// LCP and TTFB time the page the tab loaded on. a click on a link ends LCP, and by the time it is reported the
// address is already the next page's. a tab brought back from the back/forward cache is timed where it comes back
function isAboutTheLanding({ name, navigationType }: ReportedWebVital): boolean {
  const timesTheLoad = name === 'LCP' || name === 'TTFB'

  return timesTheLoad && navigationType !== 'back-forward-cache'
}

/** Reports the tab's web vitals, without ever failing the page they were measured on. */
export function createWebVitalsReporter(options: WebVitalsReporterOptions) {
  const { visitId, landingPath, currentPath, viewportWidth, countSiteEvent } = options
  let reportCount = 0

  function describe(vital: ReportedWebVital): WebVitalEvent {
    const path = isAboutTheLanding(vital) ? landingPath : currentPath()
    const value = Math.min(Math.max(vital.value, 0), largestValue)

    return { visitId, path, name: 'vitals', metric: vital.name, value, viewportWidth: Math.round(viewportWidth()) }
  }

  return function report(vital: ReportedWebVital): void {
    if (reportCount >= mostReportsPerTab || !Number.isFinite(vital.value)) return

    reportCount += 1

    try {
      countSiteEvent(describe(vital)).catch(() => undefined)
    } catch {
      // counting is never worth an error on the page
    }
  }
}
