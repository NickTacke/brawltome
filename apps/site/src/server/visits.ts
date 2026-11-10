import { siteVisitInputSchema } from '@brawltome/contracts'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { recordVisit } from './record-visit'
import { isSameOriginRequest } from './same-origin'
import type { VisitSignals } from './visit-signals'
import { currentVisitor } from './visitor'

function currentVisitSignals(): VisitSignals {
  const source = {
    fetchSite: getRequestHeader('sec-fetch-site'),
    origin: getRequestHeader('origin'),
    host: getRequestHeader('host'),
  }

  return {
    isSameOrigin: isSameOriginRequest(source),
    userAgent: getRequestHeader('user-agent'),
    acceptLanguage: getRequestHeader('accept-language'),
    doNotTrack: getRequestHeader('dnt'),
    globalPrivacyControl: getRequestHeader('sec-gpc'),
  }
}

// a post that only a page on screen sends, so prefetches, links a crawler follows and the server render never count
export const countPageView = createServerFn({ method: 'POST' })
  .validator(siteVisitInputSchema)
  .handler(({ data }) => recordVisit(data, { signals: currentVisitSignals(), visitor: currentVisitor() }))
