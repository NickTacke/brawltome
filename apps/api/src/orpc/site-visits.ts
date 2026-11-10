import { siteVisitInputSchema, siteVisitResponseSchema } from '@brawltome/contracts'
import { recordSiteVisit, type SiteVisitDependencies } from '../visits'
import { internalApiProcedure } from './context'

/** Page views the site counts for its visitors, keyed per day by the address the api trusts for them. */
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

  return { page }
}
