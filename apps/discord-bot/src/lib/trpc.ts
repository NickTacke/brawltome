import type { AppRouter } from '@brawltome/contracts'
import { telemetryFetch } from '@brawltome/telemetry'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import { discordTelemetry } from './telemetry'

const apiUrl = process.env.API_URL ?? 'http://localhost:3000'
const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
const discordInternalSecret = process.env.DISCORD_INTERNAL_API_SECRET ?? ''

export const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiUrl}/trpc`,
      transformer: superjson,
      headers: () => ({
        ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
        ...(discordInternalSecret ? { 'x-discord-internal-secret': discordInternalSecret } : {}),
      }),
      fetch: (url, init) => telemetryFetch(discordTelemetry, 'api', fetch, url, init, { propagateContext: true }),
    }),
  ],
})
