import { describe, expect, test } from 'bun:test'
import { desktopMatchLabel, opponentStatusMessage } from '../ui/opponent-status'

describe('desktop opponent status presentation', () => {
  test('does not label an unknown multiplayer match as custom', () => {
    expect(desktopMatchLabel(false)).toBe('Players')
    expect(desktopMatchLabel(true)).toBe('Ranked players')
  })

  test.each([
    [{ freshness: 'fresh', refreshState: 'idle', retryAfterSeconds: null }, 'Updated'],
    [{ freshness: 'stale', refreshState: 'idle', retryAfterSeconds: null }, 'Update delayed'],
    [{ freshness: 'missing', refreshState: 'refreshing', retryAfterSeconds: null }, 'Refreshing'],
    [
      { freshness: 'stale', refreshState: 'rateLimited', retryAfterSeconds: 900 },
      'Update delayed. Try again in 900 seconds.',
    ],
    [
      { freshness: 'unavailable', refreshState: 'temporarilyUnavailable', retryAfterSeconds: 30 },
      'Unavailable. Try again in 30 seconds.',
    ],
    [
      { freshness: 'stale', refreshState: 'temporarilyUnavailable', retryAfterSeconds: 30 },
      'Update delayed. Try again in 30 seconds.',
    ],
    [
      { freshness: 'unavailable', refreshState: 'verificationRequired', retryAfterSeconds: null },
      'Verification required. Try again.',
    ],
    [{ freshness: 'missing', refreshState: 'apiFailure', retryAfterSeconds: null }, 'Unavailable. Try again.'],
    [{ freshness: 'stale', refreshState: 'apiFailure', retryAfterSeconds: null }, 'Update delayed. Try again.'],
    [{ freshness: 'unavailable', refreshState: 'idle', retryAfterSeconds: null }, 'Unavailable'],
  ] as const)('maps %o to concise canonical language', (state, message) => {
    expect(opponentStatusMessage(state)).toBe(message)
  })
})
