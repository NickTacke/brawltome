import type { SiteEventInputContract } from '@brawltome/contracts'
import { admitVisitor, type SiteVisitor } from './admit-visitor'
import type { SiteVisitDependencies } from './record-site-visit'
import { type EventTab, recordSearchFailed, recordSearchPerformed, recordSearchSelected } from './search-events'
import { routeOf } from './visit-labels'

function recordEvent({ telemetry }: SiteVisitor, tab: EventTab, event: SiteEventInputContract): void {
  switch (event.name) {
    case 'search.performed':
      recordSearchPerformed(telemetry, tab, event)
      break
    case 'search.failed':
      recordSearchFailed(telemetry, tab, event)
      break
    case 'search.selected':
      recordSearchSelected(telemetry, tab, event)
      break
  }
}

/**
 * Counts one thing a visitor did on the site, like a search. Bots and visitors over their budget are left out the way
 * they are for page views, and the address is never logged.
 */
export async function recordSiteEvent(
  dependencies: SiteVisitDependencies,
  visitor: SiteVisitor,
  event: SiteEventInputContract,
): Promise<{ recorded: boolean }> {
  const { visitorKeys, eventLimiter } = dependencies
  const admitted = await admitVisitor({ visitorKeys, limiter: eventLimiter }, visitor)

  if (!admitted) return { recorded: false }

  // a tab left open overnight keeps its visit id, so it is logged under the day's name for it, as on a page view
  const tab = { visitId: admitted.todaysKeys.visitKeyFor(event.visitId), route: routeOf(event.path) }

  recordEvent(visitor, tab, event)

  return { recorded: true }
}
