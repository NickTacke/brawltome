import 'server-only'
import type { AppRouter } from '@brawltome/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { cookies, headers } from 'next/headers'
import superjson from 'superjson'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
const refreshTrustCookie = 'brawltome_refresh_trust'

async function createServerTrpc(propagateRefreshTrust: boolean) {
  const h = await headers()
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim()
  const ua = h.get('user-agent') ?? ''
  const incomingCookie = h.get('cookie')
  const cookieStore = propagateRefreshTrust ? await cookies() : null

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
          const response = await fetch(url, init)
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
