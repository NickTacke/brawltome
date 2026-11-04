import type { Telemetry } from '@brawltome/telemetry'
import { os } from '@orpc/server'

// the fields every procedure may read; later modules add theirs when their first procedure needs them
export interface OrpcContext {
  telemetry: Telemetry
  clientIp: string
}

// serve.ts puts the verified address in x-client-ip before any route runs; the others are fallbacks
export function readClientIp(headers: Headers): string {
  return (
    headers.get('x-client-ip') ??
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    '0.0.0.0'
  )
}

export function createOrpcContext(request: Request, telemetry: Telemetry): OrpcContext {
  return { telemetry, clientIp: readClientIp(request.headers) }
}

export const procedure = os.$context<OrpcContext>()
