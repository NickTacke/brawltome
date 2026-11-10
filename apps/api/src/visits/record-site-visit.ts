import type { SiteVisitInputContract } from '@brawltome/contracts'
import { admitVisitor, type SiteVisitor } from './admit-visitor'
import type { createDailyVisitorKeys } from './daily-visitor-key'
import { deviceOf, routeOf, viewportBucketOf } from './visit-labels'
import type { VisitLimiter } from './visit-limiter'

export type SiteVisitDependencies = {
  visitorKeys: ReturnType<typeof createDailyVisitorKeys>
  limiter: VisitLimiter
}

/**
 * Counts one page view of the site: a pageview metric by route and device, and a log line whose visitor key the
 * dashboards count once per day. The address only goes into the key, it is never logged.
 */
export async function recordSiteVisit(
  dependencies: SiteVisitDependencies,
  visitor: SiteVisitor,
  visit: SiteVisitInputContract,
): Promise<{ recorded: boolean }> {
  const admitted = await admitVisitor(dependencies, visitor)

  if (!admitted) return { recorded: false }

  const { visitorKey, todaysKeys } = admitted
  const route = routeOf(visit.path)
  const device = deviceOf(visit.viewportWidth)

  visitor.telemetry.metrics.add('analytics_pageviews_total', 1, { route, device })

  visitor.telemetry.logger.info('analytics.pageview', {
    visitId: todaysKeys.visitKeyFor(visit.visitId),
    route,
    device,
    viewport: viewportBucketOf(visit.viewportWidth),
    visitorKey,
    day: todaysKeys.day,
    referrerDomain: visit.referrerDomain ?? '',
  })

  return { recorded: true }
}
