import type { SiteVisitInputContract } from '@brawltome/contracts'
import type { Telemetry } from '@brawltome/telemetry'
import type { createDailyVisitorKeys, DayVisitorKeys } from './daily-visitor-key'
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

type DropReason = 'bot' | 'rate_limited' | 'salt_unavailable'

function dropVisit(visitor: SiteVisitor, reason: DropReason): { recorded: false } {
  visitor.telemetry.metrics.add('analytics_events_dropped_total', 1, { reason })

  return { recorded: false }
}

// undefined when the day's salt can't be read. a salt made up here instead would only hold inside this process, so
// the same visitor would get a second key from the next one
async function readTodaysKeys(
  dependencies: SiteVisitDependencies,
  visitor: SiteVisitor,
): Promise<DayVisitorKeys | undefined> {
  try {
    return await dependencies.visitorKeys.forToday()
  } catch (error) {
    visitor.telemetry.logger.error('analytics.salt.failed', error)

    return undefined
  }
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
  if (visitor.isBot) return dropVisit(visitor, 'bot')

  const todaysKeys = await readTodaysKeys(dependencies, visitor)

  if (!todaysKeys) return dropVisit(visitor, 'salt_unavailable')

  const visitorKey = todaysKeys.keyFor(visitor.clientIp, visitor.userAgent)

  if (!dependencies.limiter.allow(visitorKey)) return dropVisit(visitor, 'rate_limited')

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
