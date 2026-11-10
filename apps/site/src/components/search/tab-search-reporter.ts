import { countSiteEvent } from '../../server/visits'
import { tabVisitIdOrNull } from '../visits/tab-visit-id'
import { createSearchReporter, type SearchReporter } from './search-reporter'

/** The reporter for this tab's searches, or null for a visitor we may not count. Only for the browser. */
export function tabSearchReporter(): SearchReporter | null {
  const visitId = tabVisitIdOrNull()

  if (visitId === null) return null

  return createSearchReporter({
    visitId,
    currentPath: () => window.location.pathname,
    countSiteEvent: (event) => countSiteEvent({ data: event }),
  })
}
