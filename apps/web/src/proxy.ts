import { createEdgeRequestContext, formatTraceparent } from '@brawltome/telemetry/propagation'
import { type NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const context = createEdgeRequestContext()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', context.requestId)
  requestHeaders.set('traceparent', formatTraceparent(context))
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-request-id', context.requestId)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/metrics).*)'],
}
