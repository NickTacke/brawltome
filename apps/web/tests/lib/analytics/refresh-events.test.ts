import { describe, expect, test } from 'bun:test'
import { clampRetries, clampWaitMs, refreshStateEvent } from '../../../src/lib/analytics/refresh-events'

describe('refreshStateEvent', () => {
  const idle = { kind: 'idle' } as const

  test('maps user-visible refresh states', () => {
    expect(refreshStateEvent(idle, { kind: 'requesting' } as never, false)).toEqual({
      name: 'refresh.state',
      state: 'looking_up',
    })
    expect(refreshStateEvent(idle, { kind: 'requesting' } as never, true)).toBeNull()
    expect(refreshStateEvent(idle, { kind: 'waiting', reason: 'rateLimited', retryAt: 1 } as never, true)).toEqual({
      name: 'refresh.state',
      state: 'rate_limited',
    })
    expect(
      refreshStateEvent(idle, { kind: 'waiting', reason: 'temporarilyUnavailable', retryAt: 1 } as never, true),
    ).toEqual({ name: 'refresh.state', state: 'busy' })
    expect(refreshStateEvent(idle, { kind: 'gaveUp', reason: 'rateLimited' } as never, true)).toEqual({
      name: 'refresh.state',
      state: 'gave_up',
    })
    expect(refreshStateEvent(idle, { kind: 'timedOut' } as never, true)).toEqual({
      name: 'refresh.state',
      state: 'still_updating',
    })
    expect(refreshStateEvent(idle, { kind: 'timedOut' } as never, false)).toEqual({
      name: 'refresh.state',
      state: 'timed_out',
    })
    expect(refreshStateEvent(idle, { kind: 'verificationFailed' } as never, false)).toEqual({
      name: 'refresh.state',
      state: 'verify_failed',
    })
    expect(refreshStateEvent({ kind: 'timedOut' } as never, { kind: 'timedOut' } as never, false)).toBeNull()
  })

  test('ignores other statuses', () => {
    for (const kind of ['idle', 'polling', 'verifying']) {
      expect(refreshStateEvent({ kind: 'requesting' } as never, { kind } as never, false)).toBeNull()
    }
  })

  test('fires again when the reason changes but not when it repeats', () => {
    const a = { kind: 'waiting', reason: 'rateLimited', retryAt: 1 } as never
    const b = { kind: 'waiting', reason: 'temporarilyUnavailable', retryAt: 2 } as never
    expect(refreshStateEvent(a, { kind: 'waiting', reason: 'rateLimited', retryAt: 9 } as never, true)).toBeNull()
    expect(refreshStateEvent(a, b, true)).toEqual({ name: 'refresh.state', state: 'busy' })
  })
})

describe('clamps', () => {
  test('bounds waits and retries to schema limits', () => {
    expect(clampWaitMs(1234.6)).toBe(1235)
    expect(clampWaitMs(-5)).toBe(0)
    expect(clampWaitMs(9_999_999)).toBe(600_000)
    expect(clampWaitMs(Number.NaN)).toBe(0)
    expect(clampRetries(3)).toBe(3)
    expect(clampRetries(50)).toBe(10)
    expect(clampRetries(-1)).toBe(0)
  })
})
