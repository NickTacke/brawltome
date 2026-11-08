import type { RequestContext } from '@brawltome/foundation'
import type { Telemetry } from '@brawltome/telemetry'
import { os } from '@orpc/server'
import { internalSecretValid } from '../auth/internal-secret'
import { readClientIp } from '../client-ip'

// the fields every procedure may read; later modules add theirs when their first procedure needs them
export interface OrpcContext extends RequestContext {
  telemetry: Telemetry
  clientIp: string
}

export type OrpcContextOptions = {
  telemetry: Telemetry
  // the INTERNAL_API_SECRET the site and the bot send; without one, no caller counts as internal
  internalSecret: string | undefined
}

export function createOrpcContext(request: Request, options: OrpcContextOptions): OrpcContext {
  const providedSecret = request.headers.get('x-internal-secret') ?? undefined

  return {
    telemetry: options.telemetry,
    clientIp: readClientIp(request.headers),
    isInternalCaller: internalSecretValid(providedSecret, options.internalSecret),
  }
}

export const procedure = os.$context<OrpcContext>()
