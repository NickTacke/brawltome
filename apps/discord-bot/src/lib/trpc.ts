import type { AppRouter } from '@brawltome/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'

const apiUrl = process.env.API_URL ?? 'http://localhost:3000'
const internalSecret = process.env.INTERNAL_API_SECRET ?? ''

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiUrl}/trpc`,
      transformer: superjson,
      headers: {
        ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
      },
    }),
  ],
})
