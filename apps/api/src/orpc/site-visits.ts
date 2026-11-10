import { siteEventInputSchema, siteVisitInputSchema, siteVisitResponseSchema } from '@brawltome/contracts'
import { recordSiteEvent, recordSiteVisit, type SiteVisitDependencies } from '../visits'
import { internalApiProcedure } from './context'

/** Page views and events the site counts for its visitors, keyed per day by the address the api trusts for them. */
export function createSiteVisitProcedures(dependencies: SiteVisitDependencies) {
  const page = internalApiProcedure
    .route({
      method: 'POST',
      path: '/visits',
      operationId: 'visits.page',
      summary: 'Count a page view of the site',
      tags: ['visits'],
    })
    .input(siteVisitInputSchema)
    .output(siteVisitResponseSchema)
    .handler(({ context, input }) => {
      const { telemetry, clientIp, userAgent, isBot } = context

      return recordSiteVisit(dependencies, { telemetry, clientIp, userAgent, isBot }, input)
    })

  const event = internalApiProcedure
    .route({
      method: 'POST',
      path: '/visits/events',
      operationId: 'visits.event',
      summary: 'Count something a visitor did on the site',
      tags: ['visits'],
    })
    .input(siteEventInputSchema)
    .output(siteVisitResponseSchema)
    .handler(({ context, input }) => {
      const { telemetry, clientIp, userAgent, isBot } = context

      return recordSiteEvent(dependencies, { telemetry, clientIp, userAgent, isBot }, input)
    })

  return { page, event }
}
