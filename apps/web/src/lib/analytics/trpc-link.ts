import type { AppRouter } from '@brawltome/contracts'
import { analyticsTrpcCode } from '@brawltome/telemetry/analytics-labels'
import { TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import { track } from './browser'

const knownCodes: readonly string[] = analyticsTrpcCode

export function trpcFailureEvent(
  path: string,
  error: unknown,
): { name: 'trpc.failed'; procedure: string; code: string } {
  let code = 'NETWORK'
  if (error instanceof TRPCClientError) {
    const raw = (error.data as { code?: unknown } | null | undefined)?.code ?? error.shape?.data?.code
    code = typeof raw === 'string' ? (knownCodes.includes(raw) ? raw : 'OTHER') : 'NETWORK'
  } else if (!(error instanceof TypeError)) {
    code = 'OTHER'
  }
  return { name: 'trpc.failed', procedure: path, code }
}

export const analyticsLink: TRPCLink<AppRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        next: (value) => observer.next(value),
        error: (err) => {
          try {
            track(trpcFailureEvent(op.path, err) as Parameters<typeof track>[0])
          } catch {
            // Tracking must never swallow the original error.
          } finally {
            observer.error(err)
          }
        },
        complete: () => observer.complete(),
      }),
    )
}
