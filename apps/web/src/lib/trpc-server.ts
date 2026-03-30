import 'server-only'
import type { AppRouter } from '@brawltome/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { headers } from 'next/headers'
import superjson from 'superjson'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
const internalSecret = process.env.INTERNAL_API_SECRET ?? ''

export async function getServerTrpc(turnstileToken?: string) {
  const h = await headers()
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim()
  const ua = h.get('user-agent') ?? ''

  const outHeaders: Record<string, string> = {}
  if (ip) outHeaders['x-client-ip'] = ip
  if (ua) outHeaders['x-original-ua'] = ua
  if (internalSecret) outHeaders['x-internal-secret'] = internalSecret
  if (turnstileToken) outHeaders['x-turnstile-token'] = turnstileToken

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
        headers: outHeaders,
      }),
    ],
  })
}
