import type { Telemetry } from '@brawltome/telemetry'
import { os } from '@orpc/server'
import { readClientIp } from '../client-ip'

// the fields every procedure may read; later modules add theirs when their first procedure needs them
export interface OrpcContext {
  telemetry: Telemetry
  clientIp: string
}

export function createOrpcContext(request: Request, telemetry: Telemetry): OrpcContext {
  return { telemetry, clientIp: readClientIp(request.headers) }
}

export const procedure = os.$context<OrpcContext>()
