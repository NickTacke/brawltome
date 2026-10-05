export type RefreshClientOutcome =
  | { outcome: 'accepted' | 'alreadyRefreshing'; retry: { kind: 'poll'; afterSeconds: number } }
  | { outcome: 'notNeeded'; retry: { kind: 'none' } }
  | { outcome: 'verificationRequired'; retry: { kind: 'verify' } }
  | { outcome: 'rateLimited' | 'temporarilyUnavailable'; retry: { kind: 'after'; afterSeconds: number } }
