import { ORPCError, os } from '@orpc/server'

/** What a module's procedures may know about the request; the API process works it out once per request. */
export type RequestContext = {
  isInternalCaller: boolean
  // the raw session token of the visitor an internal caller acts for, so accounts can check it; never set for others
  visitorSessionToken?: string
}

/** The name the API's OpenAPI document gives the internal secret scheme. */
export const internalSecuritySchemeName = 'internalSecret'

const baseProcedure = os.$context<RequestContext>()

/** For reads anyone may make. */
export const publicProcedure = baseProcedure

/** For procedures only BrawlTome's own services may call, like tRPC's internalProcedure. */
export const internalProcedure = baseProcedure
  .$route({
    spec: (operation) => ({ ...operation, security: [{ [internalSecuritySchemeName]: [] }] }),
  })
  .use(({ context, next }) => {
    if (!context.isInternalCaller) throw new ORPCError('FORBIDDEN')

    return next()
  })
