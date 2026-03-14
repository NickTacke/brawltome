import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@brawltome/api/router'
import superjson from 'superjson'

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiUrl}/trpc`,
      transformer: superjson,
    }),
  ],
})
