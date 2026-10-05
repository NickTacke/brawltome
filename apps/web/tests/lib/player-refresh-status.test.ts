import { describe, expect, test } from 'bun:test'
import {
  MAX_AUTO_RETRIES,
  type PlayerRefreshState,
  getPlayerRefreshNotice,
  initialPlayerRefreshState,
  playerRefreshReducer,
  secondsUntil,
  shouldRecheckOnVisible,
} from '../../src/lib/player-refresh-status'

const NOW = 1_000_000

function requesting(overrides: Partial<PlayerRefreshState> = {}): PlayerRefreshState {
  return playerRefreshReducer(
    { ...initialPlayerRefreshState, ...overrides },
    { type: 'request', manual: false, now: NOW },
  )
}

describe('playerRefreshReducer', () => {
  test('starts requesting and records the request time', () => {
    const state = requesting()
    expect(state.status).toEqual({ kind: 'requesting' })
    expect(state.lastRequestAt).toBe(NOW)
  })

  test('starts a new polling run when the refresh is accepted', () => {
    const accepted = playerRefreshReducer(requesting(), {
      type: 'outcome',
      refresh: { outcome: 'accepted', retry: { kind: 'poll', afterSeconds: 2 } },
      now: NOW,
    })
    expect(accepted.status).toEqual({ kind: 'polling' })
    expect(accepted.pollRun).toBe(1)

    const again = playerRefreshReducer(requesting(accepted), {
      type: 'outcome',
      refresh: { outcome: 'alreadyRefreshing', retry: { kind: 'poll', afterSeconds: 2 } },
      now: NOW,
    })
    expect(again.pollRun).toBe(2)
  })

  test('schedules an automatic retry for rate limited and unavailable outcomes', () => {
    const limited = playerRefreshReducer(requesting(), {
      type: 'outcome',
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 12 } },
      now: NOW,
    })
    expect(limited.status).toEqual({ kind: 'waiting', reason: 'rateLimited', retryAt: NOW + 12_000 })
    expect(limited.autoRetries).toBe(1)

    const busy = playerRefreshReducer(requesting(), {
      type: 'outcome',
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
      now: NOW,
    })
    expect(busy.status).toEqual({ kind: 'waiting', reason: 'temporarilyUnavailable', retryAt: NOW + 30_000 })
  })

  test('gives up after the automatic retry cap', () => {
    const exhausted = playerRefreshReducer(requesting({ autoRetries: MAX_AUTO_RETRIES }), {
      type: 'outcome',
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
      now: NOW,
    })
    expect(exhausted.status).toEqual({ kind: 'gaveUp', reason: 'temporarilyUnavailable' })
  })

  test('keeps the retry count across automatic retries and resets it on manual retries', () => {
    expect(requesting({ autoRetries: 2 }).autoRetries).toBe(2)
    const manual = playerRefreshReducer(
      { ...initialPlayerRefreshState, autoRetries: 3, status: { kind: 'gaveUp', reason: 'rateLimited' } },
      { type: 'request', manual: true, now: NOW },
    )
    expect(manual.autoRetries).toBe(0)
    expect(manual.status).toEqual({ kind: 'requesting' })
  })

  test('does not retry verification and waits for the Turnstile flow', () => {
    const verify = playerRefreshReducer(requesting(), {
      type: 'outcome',
      refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } },
      now: NOW,
    })
    expect(verify.status).toEqual({ kind: 'verifying' })
    expect(verify.autoRetries).toBe(0)
    expect(playerRefreshReducer(verify, { type: 'verificationFailed' }).status).toEqual({
      kind: 'verificationFailed',
    })
  })

  test('returns to idle when no refresh is needed', () => {
    const state = playerRefreshReducer(requesting(), {
      type: 'outcome',
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
      now: NOW,
    })
    expect(state.status).toEqual({ kind: 'idle' })
  })

  test('treats a failed request like a temporary outage', () => {
    const state = playerRefreshReducer(requesting(), { type: 'requestFailed', now: NOW })
    expect(state.status).toEqual({ kind: 'waiting', reason: 'temporarilyUnavailable', retryAt: NOW + 30_000 })
  })

  test('ignores outcomes that arrive when no request is in flight', () => {
    const idle = initialPlayerRefreshState
    expect(
      playerRefreshReducer(idle, {
        type: 'outcome',
        refresh: { outcome: 'accepted', retry: { kind: 'poll', afterSeconds: 2 } },
        now: NOW,
      }),
    ).toBe(idle)
    expect(playerRefreshReducer(idle, { type: 'requestFailed', now: NOW })).toBe(idle)
  })

  test('settles polling runs', () => {
    const polling: PlayerRefreshState = { ...initialPlayerRefreshState, status: { kind: 'polling' }, pollRun: 1 }
    expect(playerRefreshReducer(polling, { type: 'pollSettled', settlement: 'done' }).status).toEqual({
      kind: 'idle',
    })
    expect(playerRefreshReducer(polling, { type: 'pollSettled', settlement: 'timeout' }).status).toEqual({
      kind: 'timedOut',
    })
    expect(playerRefreshReducer(initialPlayerRefreshState, { type: 'pollSettled', settlement: 'timeout' })).toBe(
      initialPlayerRefreshState,
    )
  })
})

describe('secondsUntil', () => {
  test('rounds up and never goes negative', () => {
    expect(secondsUntil(NOW + 11_200, NOW)).toBe(12)
    expect(secondsUntil(NOW + 12_000, NOW)).toBe(12)
    expect(secondsUntil(NOW - 500, NOW)).toBe(0)
  })
})

describe('shouldRecheckOnVisible', () => {
  const stale = { ranked: true, stats: false }
  const fresh = { ranked: false, stats: false }

  test('rechecks settled pages whose data went stale', () => {
    for (const status of [{ kind: 'idle' }, { kind: 'timedOut' }, { kind: 'gaveUp', reason: 'rateLimited' }] as const) {
      expect(shouldRecheckOnVisible({ ...initialPlayerRefreshState, status }, stale, NOW)).toBe(true)
    }
  })

  test('skips fresh data', () => {
    expect(shouldRecheckOnVisible(initialPlayerRefreshState, fresh, NOW)).toBe(false)
  })

  test('does not interrupt in-flight refreshes or the Turnstile flow', () => {
    for (const status of [
      { kind: 'requesting' },
      { kind: 'polling' },
      { kind: 'verifying' },
      { kind: 'waiting', reason: 'rateLimited', retryAt: NOW },
    ] as const) {
      expect(shouldRecheckOnVisible({ ...initialPlayerRefreshState, status }, stale, NOW)).toBe(false)
    }
  })

  test('waits at least a minute after the previous request', () => {
    const recent = { ...initialPlayerRefreshState, lastRequestAt: NOW - 30_000 }
    expect(shouldRecheckOnVisible(recent, stale, NOW)).toBe(false)
    expect(shouldRecheckOnVisible(recent, stale, NOW + 30_000)).toBe(true)
  })
})

describe('getPlayerRefreshNotice', () => {
  const waiting = { kind: 'waiting', reason: 'temporarilyUnavailable', retryAt: NOW } as const

  test('explains busy servers with a countdown', () => {
    expect(getPlayerRefreshNotice(waiting, { hasData: false, secondsLeft: 12, dataAge: null })).toEqual({
      tone: 'warning',
      title: "Brawlhalla's servers are busy",
      detail: 'Retrying in 12s.',
      countdownSeconds: 12,
      action: { label: 'Try now' },
    })
  })

  test('mentions the age of cached data while waiting', () => {
    const notice = getPlayerRefreshNotice(
      { ...waiting, reason: 'rateLimited' },
      { hasData: true, secondsLeft: 5, dataAge: '3h ago' },
    )
    expect(notice?.title).toBe('Too many update requests right now')
    expect(notice?.detail).toBe('Retrying in 5s. Showing data from 3h ago.')
  })

  test('says retrying now when the countdown reaches zero', () => {
    expect(getPlayerRefreshNotice(waiting, { hasData: false, secondsLeft: 0, dataAge: null })?.detail).toBe(
      'Retrying now...',
    )
  })

  test('offers a manual retry after giving up', () => {
    const notice = getPlayerRefreshNotice(
      { kind: 'gaveUp', reason: 'temporarilyUnavailable' },
      { hasData: true, secondsLeft: null, dataAge: '2d ago' },
    )
    expect(notice).toEqual({
      tone: 'warning',
      title: "Couldn't update this player",
      detail: "Brawlhalla's servers are still busy. Showing data from 2d ago.",
      countdownSeconds: null,
      action: { label: 'Try again' },
    })
    expect(
      getPlayerRefreshNotice(
        { kind: 'gaveUp', reason: 'rateLimited' },
        { hasData: false, secondsLeft: null, dataAge: null },
      )?.detail,
    ).toBe('Too many update requests right now. Wait a minute and try again.')
  })

  test('keeps a non-alarming notice when polling times out with cached data', () => {
    expect(
      getPlayerRefreshNotice({ kind: 'timedOut' }, { hasData: true, secondsLeft: null, dataAge: '5h ago' }),
    ).toEqual({
      tone: 'info',
      title: 'Still updating',
      detail: 'Showing data from 5h ago. Fresh stats can take a little longer to arrive.',
      countdownSeconds: null,
      action: { label: 'Refresh' },
    })
  })

  test('does not claim the player is missing when polling times out without data', () => {
    const notice = getPlayerRefreshNotice({ kind: 'timedOut' }, { hasData: false, secondsLeft: null, dataAge: null })
    expect(notice?.title).toBe("Couldn't load this player yet")
    expect(notice?.detail).toContain('Check the player ID')
    expect(notice?.action).toEqual({ label: 'Try again' })
  })

  test('explains failed verification', () => {
    const notice = getPlayerRefreshNotice(
      { kind: 'verificationFailed' },
      { hasData: true, secondsLeft: null, dataAge: 'just now' },
    )
    expect(notice?.title).toBe("Couldn't verify your browser")
    expect(notice?.action).toEqual({ label: 'Try again' })
  })

  test('shows nothing while idle, requesting, polling or verifying', () => {
    for (const status of [
      { kind: 'idle' },
      { kind: 'requesting' },
      { kind: 'polling' },
      { kind: 'verifying' },
    ] as const) {
      expect(getPlayerRefreshNotice(status, { hasData: true, secondsLeft: null, dataAge: '1h ago' })).toBeNull()
    }
  })

  test('falls back to generic wording when the data age is unknown', () => {
    expect(
      getPlayerRefreshNotice({ kind: 'timedOut' }, { hasData: true, secondsLeft: null, dataAge: null })?.detail,
    ).toBe('Showing the latest saved data. Fresh stats can take a little longer to arrive.')
  })
})
