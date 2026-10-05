import { describe, expect, test } from 'bun:test'
import { flushAnalytics, referrerDomain, sendPayload, track } from '../../../src/lib/analytics/browser'

describe('referrerDomain', () => {
  test('keeps only external hosts', () => {
    expect(referrerDomain('https://www.google.com/search?q=x', 'brawltome.app')).toBe('google.com')
    expect(referrerDomain('https://brawltome.app/player/1', 'brawltome.app')).toBeUndefined()
    expect(referrerDomain('', 'brawltome.app')).toBe('direct')
  })
})

describe('track', () => {
  test('is a no-op without a window', () => {
    expect(() => track({ name: 'pageview' })).not.toThrow()
  })
})

describe('failure isolation', () => {
  test('track and flushAnalytics never throw when the environment throws', () => {
    const saved = { window: globalThis.window, enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED }
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true'
    Object.assign(globalThis, { window: {} })
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: () => {
          throw new Error('no crypto')
        },
      },
    })
    try {
      expect(() => track({ name: 'pageview' })).not.toThrow()
      expect(() => flushAnalytics()).not.toThrow()
    } finally {
      Object.assign(globalThis, { window: saved.window })
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
      if (saved.enabled === undefined) process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = undefined
      else process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = saved.enabled
    }
  })
})

describe('sendPayload', () => {
  test('uses sendBeacon when it accepts the payload', () => {
    const fetchCalls: unknown[] = []
    const ok = sendPayload('{}', { sendBeacon: () => true }, (...args: unknown[]) => fetchCalls.push(args))
    expect(ok).toBe(true)
    expect(fetchCalls).toHaveLength(0)
  })

  test('falls back to keepalive fetch when sendBeacon is missing or refuses', () => {
    for (const nav of [{}, { sendBeacon: () => false }]) {
      const calls: [string, RequestInit][] = []
      const ok = sendPayload(
        '{"a":1}',
        nav as never,
        ((url: string, init: RequestInit) => {
          calls.push([url, init])
          return Promise.resolve()
        }) as never,
      )
      expect(ok).toBe(true)
      expect(calls[0][0]).toBe('/api/a')
      expect(calls[0][1]).toMatchObject({
        method: 'POST',
        body: '{"a":1}',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      })
    }
  })

  test('never throws, even when beacon and fetch throw or reject', async () => {
    const throwing = () => {
      throw new Error('boom')
    }
    expect(() => sendPayload('{}', { sendBeacon: throwing }, throwing as never)).not.toThrow()
    expect(() => sendPayload('{}', {}, (() => Promise.reject(new Error('x'))) as never)).not.toThrow()
    await Promise.resolve()
  })
})
