import 'server-only'
import type { AppRouter } from '@brawltome/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { headers } from 'next/headers'
import superjson from 'superjson'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export async function getServerTrpc() {
  const h = await headers()
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim()

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
        headers: ip ? { 'x-client-ip': ip } : {},
      }),
    ],
  })
}
