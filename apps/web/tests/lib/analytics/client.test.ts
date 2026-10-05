import { describe, expect, mock, test } from 'bun:test'
import { createAnalyticsClient } from '../../../src/lib/analytics/client'

function env(overrides: Record<string, unknown> = {}) {
  const sent: string[] = []
  return {
    sent,
    env: {
      enabled: true,
      doNotTrack: null,
      globalPrivacyControl: false,
      width: () => 390,
      pathname: () => '/player/123',
      now: () => 1_000,
      randomHex: () => 'c'.repeat(32),
      send: mock((body: string) => {
        sent.push(body)
        return true
      }),
      ...overrides,
    },
  }
}

describe('createAnalyticsClient', () => {
  test('stays off under DNT, GPC or the disabled flag', () => {
    for (const overrides of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { enabled: false }]) {
      const { env: e, sent } = env(overrides)
      const client = createAnalyticsClient(e as never)
      client.track({ name: 'feature.used', feature: 'pin' })
      client.flush()
      expect(client.enabled).toBe(false)
      expect(sent).toHaveLength(0)
    }
  })

  test('decorates events with tab, route template, device and viewport', () => {
    const { env: e, sent } = env()
    const client = createAnalyticsClient(e as never)
    client.track({ name: 'feature.used', feature: 'pin' })
    client.flush()
    const batch = JSON.parse(sent[0])
    expect(batch.events[0]).toMatchObject({
      tabId: 'c'.repeat(32),
      route: '/player/[id]',
      device: 'mobile',
      viewport: '<640',
      name: 'feature.used',
    })
  })

  test('flushes at 60 events and sends at most 60 per batch, surviving a failed beacon', () => {
    const received: string[] = []
    const { env: e } = env({
      send: (body: string) => {
        received.push(body)
        return false
      },
    })
    const client = createAnalyticsClient(e as never)
    for (let index = 0; index < 150; index++) client.track({ name: 'feature.used', feature: 'pin' })
    expect(received).toHaveLength(2)
    expect(() => {
      client.flush()
      client.flush()
    }).not.toThrow()
    const sizes = received.map((body) => JSON.parse(body).events.length)
    expect(sizes.every((size) => size <= 60)).toBe(true)
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(150)
  })

  test('never touches device storage', () => {
    const touched: string[] = []
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get: () => {
            touched.push(name)
            return () => null
          },
        },
      )
    const saved = {
      localStorage: globalThis.localStorage,
      sessionStorage: globalThis.sessionStorage,
      indexedDB: globalThis.indexedDB,
      document: globalThis.document,
    }
    Object.assign(globalThis, {
      localStorage: trap('localStorage'),
      sessionStorage: trap('sessionStorage'),
      indexedDB: trap('indexedDB'),
      document: trap('document'),
    })
    try {
      const { env: e } = env()
      const client = createAnalyticsClient(e as never)
      client.track({ name: 'feature.used', feature: 'pin' })
      client.flush()
    } finally {
      Object.assign(globalThis, saved)
    }
    expect(touched).toEqual([])
  })
})

describe('createAnalyticsClient timing', () => {
  test('clamps t to 24 hours', () => {
    let now = 0
    const { env: e, sent } = env({ now: () => now })
    const client = createAnalyticsClient(e as never)
    now = 90_000_000
    client.track({ name: 'feature.used', feature: 'pin' })
    client.flush()
    expect(JSON.parse(sent[0]).events[0].t).toBe(86_400_000)
  })
})
