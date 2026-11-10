import type { Telemetry } from '@brawltome/telemetry'
import type { createDailyVisitorKeys, DayVisitorKeys } from './daily-visitor-key'
import type { VisitLimiter } from './visit-limiter'

export type SiteVisitor = {
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
  clientIp: string
  userAgent: string
  isBot: boolean
}

/** A visitor whose page view or event counts: their key for the day, and the day's keys it was made with. */
export type AdmittedVisitor = { visitorKey: string; todaysKeys: DayVisitorKeys }

type Admission = { visitorKeys: ReturnType<typeof createDailyVisitorKeys>; limiter: VisitLimiter }
type DropReason = 'bot' | 'rate_limited' | 'salt_unavailable'

function drop(visitor: SiteVisitor, reason: DropReason): null {
  visitor.telemetry.metrics.add('analytics_events_dropped_total', 1, { reason })

  return null
}

// undefined when the day's salt can't be read. a salt made up here instead would only hold inside this process, so
// the same visitor would get a second key from the next one
async function readTodaysKeys({ visitorKeys }: Admission, visitor: SiteVisitor): Promise<DayVisitorKeys | undefined> {
  try {
    return await visitorKeys.forToday()
  } catch (error) {
    visitor.telemetry.logger.error('analytics.salt.failed', error)

    return undefined
  }
}

/**
 * Decides whether a visitor's page view or event counts. Bots, visitors over the limiter's budget and anyone who
 * comes while the day's salt can't be read get null and are counted as drops.
 */
export async function admitVisitor(admission: Admission, visitor: SiteVisitor): Promise<AdmittedVisitor | null> {
  if (visitor.isBot) return drop(visitor, 'bot')

  const todaysKeys = await readTodaysKeys(admission, visitor)

  if (!todaysKeys) return drop(visitor, 'salt_unavailable')

  const visitorKey = todaysKeys.keyFor(visitor.clientIp, visitor.userAgent)

  if (!admission.limiter.allow(visitorKey)) return drop(visitor, 'rate_limited')

  return { visitorKey, todaysKeys }
}
