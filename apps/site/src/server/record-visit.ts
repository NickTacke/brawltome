import '@tanstack/react-start/server-only'
import { type SiteVisitInputContract, siteVisitResponseSchema } from '@brawltome/contracts'
import { postApi } from './api'
import { failureText, optionalRead } from './optional-read'
import { isCountableVisit, type VisitSignals } from './visit-signals'
import type { Visitor } from './visitor-headers'

export type VisitRequest = { signals: VisitSignals; visitor: Visitor }

/**
 * Passes a page view to the api, which keys it to the visitor for the day. Best effort, never throws: the address
 * travels in the visitor headers and never into a log line here.
 */
export async function recordVisit(visit: SiteVisitInputContract, { signals, visitor }: VisitRequest): Promise<void> {
  if (!isCountableVisit(signals)) return

  try {
    await postApi('/visits', visit, siteVisitResponseSchema, 'count a page view', {
      ...optionalRead,
      headers: visitor.headers,
    })
  } catch (error) {
    console.error(failureText(error))
  }
}
