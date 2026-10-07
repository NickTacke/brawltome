import 'server-only'
import type { AppRouter } from '@brawltome/contracts'
import { telemetryFetch } from '@brawltome/telemetry'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { cookies, headers } from 'next/headers'
import superjson from 'superjson'
import { resolveServerApiUrl } from './api-url'
import { webTelemetry } from './telemetry'

const apiUrl = resolveServerApiUrl()
const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
const refreshTrustCookie = 'brawltome_refresh_trust'

async function createServerTrpc(propagateRefreshTrust: boolean) {
  const h = await headers()
  const ua = h.get('user-agent') ?? ''
  const incomingCookie = h.get('cookie')
  const cookieStore = propagateRefreshTrust ? await cookies() : null
  const telemetryContext = webTelemetry.contextFromHeaders(
    {
      'x-request-id': h.get('x-request-id'),
      traceparent: h.get('traceparent'),
    },
    { acceptIncoming: true },
  )

  const outHeaders: Record<string, string> = {}
  // Pass the ingress evidence through untouched; the API decides which visitor address to trust
  // (apps/api/src/client-ip.ts). X-Real-Ip is set by Traefik, so a client reaching the origin directly can't forge it.
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for']) {
    const value = h.get(name)
    if (value) outHeaders[name] = value
  }
  if (ua) outHeaders['x-original-ua'] = ua
  if (incomingCookie) outHeaders.cookie = incomingCookie
  if (internalSecret) outHeaders['x-internal-secret'] = internalSecret

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
        headers: outHeaders,
        fetch: async (url, init) => {
          const response = await webTelemetry.run(telemetryContext, () =>
            telemetryFetch(webTelemetry, 'api', fetch, url, init, { propagateContext: true }),
          )
          if (cookieStore) {
            const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
            for (const setCookie of setCookies) {
              const match = setCookie.match(/(?:^|,\s*)brawltome_refresh_trust=([^;]+)/)
              if (!match) continue
              cookieStore.set(refreshTrustCookie, decodeURIComponent(match[1]), {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                maxAge: 86_400,
              })
            }
          }
          return response
        },
      }),
    ],
  })
}

export function getServerTrpc() {
  return createServerTrpc(false)
}

export function getServerActionTrpc() {
  return createServerTrpc(true)
}
