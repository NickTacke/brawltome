import '@tanstack/react-start/server-only'
import { type SiteEventInputContract, type SiteVisitInputContract, siteVisitResponseSchema } from '@brawltome/contracts'
import { postApi } from './api'
import { failureText, optionalRead } from './optional-read'
import { isCountableVisit, type VisitSignals } from './visit-signals'
import type { Visitor } from './visitor-headers'

export type VisitRequest = { signals: VisitSignals; visitor: Visitor }

// best effort, never throws: the address travels in the visitor headers, and the failure text only says what was
// being counted, so neither the address nor a search query reaches a log line here
async function passToApi(path: string, counted: unknown, action: string, request: VisitRequest): Promise<void> {
  const { signals, visitor } = request

  if (!isCountableVisit(signals)) return

  try {
    await postApi(path, counted, siteVisitResponseSchema, action, { ...optionalRead, headers: visitor.headers })
  } catch (error) {
    console.error(failureText(error))
  }
}

/** Passes a page view to the api, which keys it to the visitor for the day. */
export function recordVisit(visit: SiteVisitInputContract, request: VisitRequest): Promise<void> {
  return passToApi('/visits', visit, 'count a page view', request)
}

/** Passes something a visitor did on a page, like a search, to the api under the same rules as a page view. */
export function recordSiteEvent(event: SiteEventInputContract, request: VisitRequest): Promise<void> {
  return passToApi('/visits/events', event, 'count a site event', request)
}
