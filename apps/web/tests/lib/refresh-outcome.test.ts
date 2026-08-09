import { describe, expect, test } from 'bun:test'
import { type RefreshClientOutcome, getRefreshClientAction } from '../../src/lib/refresh-outcome'

const outcomes: RefreshClientOutcome[] = [
  { outcome: 'accepted', retry: { kind: 'poll', afterSeconds: 2 } },
  { outcome: 'alreadyRefreshing', retry: { kind: 'poll', afterSeconds: 2 } },
  { outcome: 'notNeeded', retry: { kind: 'none' } },
  { outcome: 'verificationRequired', retry: { kind: 'verify' } },
  { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 77 } },
  { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
]

describe('interactive refresh client behavior', () => {
  test.each(outcomes)('maps $outcome without polling blocked refreshes', (refresh) => {
    expect(getRefreshClientAction(refresh)).toEqual({
      poll: refresh.outcome === 'accepted' || refresh.outcome === 'alreadyRefreshing',
      verify: refresh.outcome === 'verificationRequired',
      message:
        refresh.outcome === 'rateLimited'
          ? 'Update delayed. Try again in 77 seconds.'
          : refresh.outcome === 'temporarilyUnavailable'
            ? 'Unavailable. Try again in 30 seconds.'
            : null,
    })
  })
})
