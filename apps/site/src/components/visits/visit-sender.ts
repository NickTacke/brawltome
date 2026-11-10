import type { SiteVisitInputContract } from '@brawltome/contracts'

type VisitSenderOptions = {
  visitId: string
  viewportWidth: () => number
  referrerDomain: string | undefined
  countPageView: (visit: SiteVisitInputContract) => Promise<unknown>
}

/** Sends one page view, without ever failing the page that sends it. */
export function createVisitSender({ visitId, viewportWidth, referrerDomain, countPageView }: VisitSenderOptions) {
  return (path: string, isFirstView: boolean): void => {
    const visit: SiteVisitInputContract = { visitId, path, viewportWidth: Math.round(viewportWidth()) }

    // the referrer only explains how the tab arrived, later pages came from this site
    if (isFirstView && referrerDomain) visit.referrerDomain = referrerDomain

    try {
      countPageView(visit).catch(() => undefined)
    } catch {
      // counting is never worth an error on the page
    }
  }
}
