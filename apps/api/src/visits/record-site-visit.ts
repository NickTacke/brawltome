import type { SiteVisitInputContract } from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import type { createDailyVisitorKeys } from './daily-visitor-key'
import { deviceOf, routeOf, viewportBucketOf } from './visit-labels'
import type { VisitLimiter } from './visit-limiter'

export type SiteVisitDependencies = {
  visitorKeys: ReturnType<typeof createDailyVisitorKeys>
  limiter: VisitLimiter
}

export type SiteVisitor = {
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
  clientIp: string
  userAgent: string
  isBot: boolean
}

function dropVisit(visitor: SiteVisitor, reason: 'bot' | 'rate_limited'): { recorded: false } {
  visitor.telemetry.metrics.add('analytics_events_dropped_total', 1, { reason })

  return { recorded: false }
}

/**
 * Counts one page view of the site: a pageview metric by route and device, and a log line whose visitor key the
 * dashboards count once per day. The address only goes into the key, it is never logged.
 */
export function recordSiteVisit(
  dependencies: SiteVisitDependencies,
  visitor: SiteVisitor,
  visit: SiteVisitInputContract,
): { recorded: boolean } {
  if (visitor.isBot) return dropVisit(visitor, 'bot')

  const { key, day } = dependencies.visitorKeys.keyFor(visitor.clientIp, visitor.userAgent)

  if (!dependencies.limiter.allow(key)) return dropVisit(visitor, 'rate_limited')

  const route = routeOf(visit.path)
  const device = deviceOf(visit.viewportWidth)

  visitor.telemetry.metrics.add('analytics_pageviews_total', 1, { route, device })

  visitor.telemetry.logger.info('analytics.pageview', {
    visitId: visit.visitId,
    route,
    device,
    viewport: viewportBucketOf(visit.viewportWidth),
    visitorKey: key,
    day,
    referrerDomain: visit.referrerDomain ?? '',
  })

  return { recorded: true }
}
