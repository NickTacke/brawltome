import { internalSecuritySchemeName, type RequestContext } from '@brawltome/foundation'
import type { Telemetry } from '@brawltome/telemetry'
import { ORPCError, os } from '@orpc/server'
import { internalSecretValid } from '../auth/internal-secret'
import { isBotUserAgent } from '../bot-user-agent'
import { readClientIp } from '../client-ip'

// module procedures only see foundation's RequestContext, so a field a module needs goes there; these extra fields
// are for the API's own procedures
export interface OrpcContext extends RequestContext {
  telemetry: Telemetry
  clientIp: string
  isBot: boolean
}

export type OrpcContextOptions = {
  telemetry: Telemetry
  // the INTERNAL_API_SECRET the site and the bot send; without one, no caller counts as internal
  internalSecret: string | undefined
}

export function createOrpcContext(request: Request, options: OrpcContextOptions): OrpcContext {
  const providedSecret = request.headers.get('x-internal-secret') ?? undefined
  const isInternalCaller = internalSecretValid(providedSecret, options.internalSecret)
  // the site calls for its visitors, so it names their user agent; anyone else is judged by their own
  const visitorUserAgent = isInternalCaller ? request.headers.get('x-visitor-user-agent') : null
  const userAgent = visitorUserAgent ?? request.headers.get('user-agent') ?? ''

  return {
    telemetry: options.telemetry,
    clientIp: readClientIp(request.headers),
    isBot: isBotUserAgent(userAgent),
    isInternalCaller,
  }
}

export const procedure = os.$context<OrpcContext>()

/** The API's own procedures that only BrawlTome's services may call, guarded like foundation's internalProcedure. */
export const internalApiProcedure = procedure
  .$route({
    spec: (operation) => ({ ...operation, security: [{ [internalSecuritySchemeName]: [] }] }),
  })
  .use(({ context, next }) => {
    if (!context.isInternalCaller) throw new ORPCError('FORBIDDEN')

    return next()
  })
