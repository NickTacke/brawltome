import { failureBackoffMs, linkedTtlMs, noneTtlMs } from './refresh-timing'

export type EsportsFreshness = 'fresh' | 'stale' | 'missing'

// what the stored player row says about the last refresh
export type RefreshState = { link: 'linked' | 'none'; checkedAt: Date; failureCount: number }

/** Whether a player's stored esports data is due a refresh; missing when it was never fetched. */
export function esportsFreshness(state: RefreshState | null, now: Date): EsportsFreshness {
  if (!state) return 'missing'

  const sinceCheckMs = now.getTime() - state.checkedAt.getTime()

  // a failed refresh moves checked_at, so the back-off counts from the failure; once it is over the next try is due,
  // or a first fetch that failed would wait the 30 days of a player brawltools does not know
  if (state.failureCount > 0) return sinceCheckMs <= failureBackoffMs ? 'fresh' : 'stale'

  const ttlMs = state.link === 'linked' ? linkedTtlMs : noneTtlMs

  return sinceCheckMs <= ttlMs ? 'fresh' : 'stale'
}
