import type { AppRouter } from '@brawltome/api/router'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'

const apiUrl = process.env.API_URL ?? 'http://localhost:3000'

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiUrl}/trpc`,
      transformer: superjson,
    }),
  ],
})
