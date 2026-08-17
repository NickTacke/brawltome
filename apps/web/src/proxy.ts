import { QUEUE_PREFERENCE_COOKIE, parseQueueSearchParams, queuePreferenceValue } from '@/components/Queue/utils'
import { createEdgeRequestContext, formatTraceparent } from '@brawltome/telemetry/propagation'
import { type NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const context = createEdgeRequestContext()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', context.requestId)
  requestHeaders.set('traceparent', formatTraceparent(context))
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-request-id', context.requestId)

  if (request.nextUrl.pathname === '/queue') {
    const mode = request.nextUrl.searchParams.get('mode')
    const region = request.nextUrl.searchParams.get('region')
    const filters = parseQueueSearchParams({ mode: mode ?? undefined, region: region ?? undefined })
    if (mode === filters.mode && region === filters.region) {
      response.cookies.set(QUEUE_PREFERENCE_COOKIE, queuePreferenceValue(filters), {
        maxAge: 365 * 24 * 60 * 60,
        path: '/',
        sameSite: 'lax',
      })
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/metrics).*)'],
}
