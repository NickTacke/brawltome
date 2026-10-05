import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { ingestBatch } from '../../../src/lib/analytics/ingest'
import { createTabRateLimiter } from '../../../src/lib/analytics/rate-limit'
import { createDailySalt } from '../../../src/lib/analytics/salt'

const tabId = 'b'.repeat(32)
const base = { tabId, route: '/player/[id]', device: 'mobile', viewport: '<640', t: 10 }

function setup(now = Date.parse('2026-10-05T23:59:59Z')) {
  const sink = createMemorySink()
  const telemetry = createTelemetry({ service: 'web', sink, capacity: 100, drainIntervalMs: 0 })
  let clock = now
  let seed = 0
  const salt = createDailySalt(
    () => clock,
    (bytes) => new Uint8Array(bytes).fill(++seed),
  )
  const limiter = createTabRateLimiter(30, () => clock)
  const ipLimiter = createTabRateLimiter(120, () => clock)
  return {
    sink,
    telemetry,
    salt,
    limiter,
    ipLimiter,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('ingestBatch', () => {
  test('records metrics and scrubbed logs without ip or user agent', async () => {
    const { sink, telemetry, salt, limiter, ipLimiter } = setup()
    ingestBatch(
      {
        body: {
          events: [
            { ...base, name: 'pageview', referrerDomain: 'discord.com' },
            {
              ...base,
              name: 'search.performed',
              source: 'bar',
              query: '  token=abc https://x.y  ',
              results: 0,
              aliasResults: 0,
              latencyMs: 90,
            },
            {
              ...base,
              name: 'error.client',
              kind: 'unhandled',
              message: 'boom https://api.brawlhalla.com/x?api_key=SECRET',
            },
          ],
        },
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 Test',
      },
      { telemetry, salt, limiter, ipLimiter },
    )
    await telemetry.flush(100)
    const output = JSON.stringify(sink.records)
    expect(output).not.toContain('203.0.113.7')
    expect(output).not.toContain('Mozilla/5.0 Test')
    expect(output).not.toContain('SECRET')
    expect(output).toContain('analytics.search.performed')
    expect(output).toContain('analytics.error.client')
    expect(output).toContain('[redacted]')
    expect(output).toContain('visitorKey')
    expect(output).toContain('tabId')
    expect(output).not.toContain('https://x.y')
    expect(output).not.toContain('abc')
    const names = telemetry.metrics.snapshot().map((metric) => metric.name)
    expect(names).toContain('analytics_pageviews_total')
    expect(names).toContain('analytics_searches_total')
  })

  test('maps vitals to a metric without a log, and normalizes unknown trpc labels', async () => {
    const { sink, telemetry, salt, limiter, ipLimiter } = setup()
    ingestBatch(
      {
        body: {
          events: [
            { ...base, name: 'vitals', metric: 'LCP', value: 1200 },
            { ...base, name: 'trpc.failed', procedure: 'evil.proc', code: 'WEIRD' },
          ],
        },
        ip: '1.1.1.1',
        userAgent: 'a',
      },
      { telemetry, salt, limiter, ipLimiter },
    )
    await telemetry.flush(100)
    const output = JSON.stringify(sink.records)
    expect(output).not.toContain('analytics.vitals')
    expect(output).toContain('analytics.trpc.failed')
    const snapshot = JSON.stringify(telemetry.metrics.snapshot())
    expect(snapshot).toContain('analytics_web_vitals')
    expect(snapshot).toContain('"procedure":"other"')
    expect(snapshot).toContain('"code":"OTHER"')
  })

  test('drops hostile bodies with a reason and never throws', () => {
    const { telemetry, salt, limiter, ipLimiter } = setup()
    for (const body of [null, 'x', { events: 'no' }, { events: [{ ...base, name: 'evil' }] }]) {
      expect(() => ingestBatch({ body, ip: '1.1.1.1', userAgent: 'a' }, { telemetry, salt, limiter, ipLimiter })).not.toThrow()
    }
    ingestBatch(
      {
        body: { events: Array.from({ length: 61 }, () => ({ ...base, name: 'pageview' })) },
        ip: '1.1.1.1',
        userAgent: 'a',
      },
      { telemetry, salt, limiter, ipLimiter },
    )
    const dropped = telemetry.metrics.snapshot().find((metric) => metric.name === 'analytics_events_dropped_total')
    expect(JSON.stringify(dropped)).toContain('too_many')
    expect(JSON.stringify(dropped)).toContain('invalid')
  })

  test('rate limits per tab', () => {
    const { telemetry, salt, ipLimiter } = setup()
    const limiter = createTabRateLimiter(2, () => 0)
    for (let index = 0; index < 3; index++) {
      ingestBatch(
        { body: { events: [{ ...base, name: 'pageview' }] }, ip: '1.1.1.1', userAgent: 'a' },
        { telemetry, salt, limiter, ipLimiter },
      )
    }
    const dropped = telemetry.metrics.snapshot().find((metric) => metric.name === 'analytics_events_dropped_total')
    expect(JSON.stringify(dropped)).toContain('rate_limited')
  })
})

describe('ingestBatch abuse limits', () => {
  const dropReasons = (telemetry: ReturnType<typeof setup>['telemetry']) =>
    JSON.stringify(telemetry.metrics.snapshot().find((metric) => metric.name === 'analytics_events_dropped_total'))

  test('rate limits per client ip across rotating tab ids', () => {
    const { telemetry, salt, limiter } = setup()
    const ipLimiter = createTabRateLimiter(2, () => 0)
    for (let index = 0; index < 3; index++) {
      const rotating = String(index).repeat(32)
      ingestBatch(
        { body: { events: [{ ...base, tabId: rotating, name: 'pageview' }] }, ip: '198.51.100.4', userAgent: 'a' },
        { telemetry, salt, limiter, ipLimiter },
      )
    }
    const pageviews = telemetry.metrics.snapshot().find((metric) => metric.name === 'analytics_pageviews_total')
    expect(JSON.stringify(pageviews?.series)).toContain('"value":2')
    expect(dropReasons(telemetry)).toContain('rate_limited')
  })

  test('never exposes the ip in metrics', () => {
    const { telemetry, salt, limiter, ipLimiter } = setup()
    ingestBatch(
      { body: { events: [{ ...base, name: 'pageview' }] }, ip: '198.51.100.4', userAgent: 'a' },
      { telemetry, salt, limiter, ipLimiter },
    )
    expect(JSON.stringify(telemetry.metrics.snapshot())).not.toContain('198.51.100.4')
  })

  test('rejects a batch whose events do not share one tabId', () => {
    const { telemetry, salt, limiter, ipLimiter } = setup()
    ingestBatch(
      {
        body: {
          events: [
            { ...base, name: 'pageview' },
            { ...base, tabId: 'e'.repeat(32), name: 'pageview' },
          ],
        },
        ip: '1.1.1.1',
        userAgent: 'a',
      },
      { telemetry, salt, limiter, ipLimiter },
    )
    const snapshot = telemetry.metrics.snapshot()
    expect(snapshot.find((metric) => metric.name === 'analytics_pageviews_total')).toBeUndefined()
    expect(dropReasons(telemetry)).toContain('invalid')
    expect(dropReasons(telemetry)).toContain('"value":2')
  })
})

describe('createDailySalt', () => {
  test('stable within a UTC day, rotates at midnight', () => {
    const { salt, advance } = setup(Date.parse('2026-10-05T23:59:58Z'))
    const first = salt.visitorKey('1.2.3.4', 'ua')
    expect(salt.visitorKey('1.2.3.4', 'ua')).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    advance(5_000)
    expect(salt.visitorKey('1.2.3.4', 'ua')).not.toBe(first)
  })
})

describe('ingestBatch per-event validation', () => {
  test('records valid events and drops only the invalid one', () => {
    const { telemetry, salt, limiter, ipLimiter } = setup()
    ingestBatch(
      {
        body: {
          events: [
            { ...base, name: 'feature.used', feature: 'pin' },
            { ...base, name: 'feature.used', feature: 'not-a-feature' },
            { ...base, name: 'feature.used', feature: 'pin' },
          ],
        },
        ip: '1.1.1.1',
        userAgent: 'ua',
      },
      { telemetry, salt, limiter, ipLimiter },
    )
    const snapshot = telemetry.metrics.snapshot()
    const uses = snapshot.find((metric) => metric.name === 'analytics_feature_use_total')
    const dropped = snapshot.find((metric) => metric.name === 'analytics_events_dropped_total')
    expect(JSON.stringify(uses?.series)).toContain('"value":2')
    expect(JSON.stringify(dropped?.series)).toContain('"value":1')
    expect(JSON.stringify(dropped?.series)).toContain('invalid')
  })
})
