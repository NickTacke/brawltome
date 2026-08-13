export type RefreshClientOutcome =
  | { outcome: 'accepted' | 'alreadyRefreshing'; retry: { kind: 'poll'; afterSeconds: number } }
  | { outcome: 'notNeeded'; retry: { kind: 'none' } }
  | { outcome: 'verificationRequired'; retry: { kind: 'verify' } }
  | { outcome: 'rateLimited' | 'temporarilyUnavailable'; retry: { kind: 'after'; afterSeconds: number } }

export function getRefreshClientAction(refresh: RefreshClientOutcome) {
  const poll = refresh.outcome === 'accepted' || refresh.outcome === 'alreadyRefreshing'
  const verify = refresh.outcome === 'verificationRequired'
  let message: string | null = null
  if (refresh.outcome === 'rateLimited') {
    message = `Update delayed. Try again in ${refresh.retry.afterSeconds} seconds.`
  } else if (refresh.outcome === 'temporarilyUnavailable') {
    message = `Unavailable. Try again in ${refresh.retry.afterSeconds} seconds.`
  }
  return { poll, verify, message }
}
