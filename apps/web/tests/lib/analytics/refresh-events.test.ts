import { describe, expect, test } from 'bun:test'
import {
  abandonRefresh,
  clampRetries,
  clampWaitMs,
  createStateDeduper,
  isPageExit,
  refreshStateEvent,
} from '../../../src/lib/analytics/refresh-events'

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

describe('createStateDeduper', () => {
  test('lets each state through once per cycle and resets on a new cycle', () => {
    const dedupe = createStateDeduper()
    const busy = { name: 'refresh.state', state: 'busy' } as const
    const gaveUp = { name: 'refresh.state', state: 'gave_up' } as const
    expect(dedupe.allow(busy)).toBe(true)
    expect(dedupe.allow(busy)).toBe(false)
    expect(dedupe.allow(gaveUp)).toBe(true)
    dedupe.reset()
    expect(dedupe.allow(busy)).toBe(true)
  })
})

describe('abandonRefresh', () => {
  const calls = () => {
    const log: string[] = []
    return { log, deps: { track: (e: { name: string }) => log.push(e.name), flush: () => log.push('flush') } }
  }

  test('tracks and flushes once per cycle for active statuses', () => {
    const { log, deps } = calls()
    const flag = { current: false }
    expect(abandonRefresh('polling', flag, 1234, deps)).toBe(true)
    expect(abandonRefresh('polling', flag, 1234, deps)).toBe(false)
    expect(log).toEqual(['refresh.abandoned', 'flush'])
  })

  test('ignores inactive statuses', () => {
    const { log, deps } = calls()
    expect(abandonRefresh('idle', { current: false }, 5, deps)).toBe(false)
    expect(log).toEqual([])
  })
})

describe('isPageExit', () => {
  test('treats back/forward-cache page hides as not leaving', () => {
    expect(isPageExit({ persisted: true })).toBe(false)
    expect(isPageExit({ persisted: false })).toBe(true)
  })
})
