import type { AppRouter } from '@brawltome/contracts'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import { publicApiUrl } from './api-url'

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  )
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${publicApiUrl}/trpc`,
      transformer: superjson,
      fetch: (url, opts) => {
        const headers = new Headers(opts?.headers)
        headers.set('x-request-id', crypto.randomUUID())
        headers.set('traceparent', `00-${randomHex(16)}-${randomHex(8)}-00`)
        return fetch(url, { ...opts, headers, credentials: 'include' })
      },
    }),
  ],
})
