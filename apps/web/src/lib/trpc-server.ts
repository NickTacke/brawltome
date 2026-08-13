import 'server-only'
import type { AppRouter } from '@brawltome/api/router'
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
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim()
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
  if (ip) outHeaders['x-client-ip'] = ip
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
