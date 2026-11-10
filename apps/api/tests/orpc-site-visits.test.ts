import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import type { Database } from '@brawltome/foundation'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { requestWithVerifiedClientIp } from '../src/client-ip'
import { createOrpcRoutes } from '../src/orpc/mount'
import { createOrpcRouter } from '../src/orpc/router'
import { createSiteVisitProcedures } from '../src/orpc/site-visits'
import { createDailyVisitorKeys, createVisitLimiter } from '../src/visits'

const internalSecret = 'site-visits-test-internal-secret-01234567'
const siteAddress = '172.18.0.9'
const visitorAddress = '198.51.100.20'
const cloudflareEdge = '188.114.97.3'
const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
const visit = { visitId: 'b'.repeat(32), path: '/player/7', viewportWidth: 1280, referrerDomain: 'reddit.com' }

const siteHeaders = {
  'content-type': 'application/json',
  'x-internal-secret': internalSecret,
  'x-visitor-real-ip': visitorAddress,
  'x-visitor-user-agent': browser,
}

function createHarness({ visitsPerMinute = 120 } = {}) {
  const sink = createMemorySink()
  const telemetry = createTelemetry({ service: 'api', sink, drainIntervalMs: 0 })
  const visitorKeys = createDailyVisitorKeys({ now: Date.now, randomBytes: (size) => randomBytes(size) })
  const visits = createSiteVisitProcedures({ visitorKeys, limiter: createVisitLimiter(visitsPerMinute, Date.now) })
  const router = createOrpcRouter([], { database: {} as Database }, { visits })
  const app = new Hono()

  app.route('/', createOrpcRoutes({ telemetry, internalSecret, router }))

  // goes through the same address check serve.ts runs before any route
  async function send(headers: Record<string, string> = siteHeaders, body: unknown = visit) {
    const init = { method: 'POST', headers, body: JSON.stringify(body) }
    const request = new Request('http://api.test/v1/visits', init)
    const response = await app.fetch(requestWithVerifiedClientIp(request, siteAddress, internalSecret))

    return { status: response.status, body: await response.json() }
  }

  async function pageviewLogs() {
    await telemetry.flush(1_000)

    return sink.records.filter((record) => record.event === 'analytics.pageview')
  }

  const counted = (name: string) =>
    telemetry.metrics
      .snapshot()
      .find((metric) => metric.name === name)
      ?.series.map((series) => series) ?? []

  return { send, pageviewLogs, counted, sink, telemetry }
}

describe('site visit procedure', () => {
  test('refuses callers without the internal secret', async () => {
    const harness = createHarness()
    const { 'x-internal-secret': _secret, ...withoutSecret } = siteHeaders

    expect((await harness.send(withoutSecret)).status).toBe(403)
    expect(await harness.pageviewLogs()).toEqual([])
  })

  test('counts a page view under its route, with a daily visitor key', async () => {
    const harness = createHarness()

    expect(await harness.send()).toEqual({ status: 200, body: { recorded: true } })

    const [log] = await harness.pageviewLogs()

    expect(log.attributes).toMatchObject({
      route: '/player/[id]',
      device: 'desktop',
      viewport: '1024-1440',
      referrerDomain: 'reddit.com',
    })

    expect(log.attributes?.visitorKey).toMatch(/^[0-9a-f]{32}$/)
    // the tab's id is only logged renamed with the day's secret, so it can't link one day to the next
    expect(log.attributes?.visitId).toMatch(/^[0-9a-f]{32}$/)
    expect(log.attributes?.visitId).not.toBe(visit.visitId)
    expect(log.attributes?.day).toBe(new Date().toISOString().slice(0, 10))

    expect(harness.counted('analytics_pageviews_total')).toMatchObject([
      { labels: { route: '/player/[id]', device: 'desktop' }, value: 1 },
    ])
  })

  test("labels the new site's own pages instead of folding them into other", async () => {
    const harness = createHarness()

    for (const path of ['/guild/9', '/leaderboard', '/guilds', '/terms'])
      await harness.send(siteHeaders, { ...visit, path })

    const routes = (await harness.pageviewLogs()).map((log) => log.attributes?.route)

    expect(routes).toEqual(['/guild/[id]', '/leaderboard', '/guilds', '/terms'])
  })

  test('the same visitor gets the same key on every page', async () => {
    const harness = createHarness()

    await harness.send()
    await harness.send(siteHeaders, { ...visit, path: '/queue', visitId: 'c'.repeat(32) })

    const [first, second] = await harness.pageviewLogs()

    expect(second.attributes?.visitorKey).toBe(first.attributes?.visitorKey as string)
  })

  test('two visitors behind the same cloudflare edge get different keys', async () => {
    const harness = createHarness()
    const viaCloudflare = { ...siteHeaders, 'x-visitor-real-ip': cloudflareEdge }

    await harness.send({ ...viaCloudflare, 'x-visitor-cf-connecting-ip': '203.0.113.1' })
    await harness.send({ ...viaCloudflare, 'x-visitor-cf-connecting-ip': '203.0.113.2' })

    const [first, second] = await harness.pageviewLogs()

    expect(second.attributes?.visitorKey).not.toBe(first.attributes?.visitorKey as string)
  })

  test.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0) Chrome-Lighthouse',
  ])('drops a bot: %s', async (userAgent) => {
    const harness = createHarness()

    expect((await harness.send({ ...siteHeaders, 'x-visitor-user-agent': userAgent })).body).toEqual({
      recorded: false,
    })

    expect(await harness.pageviewLogs()).toEqual([])
    expect(harness.counted('analytics_events_dropped_total')).toMatchObject([{ labels: { reason: 'bot' }, value: 1 }])
  })

  test('drops views over the per visitor budget', async () => {
    const harness = createHarness({ visitsPerMinute: 2 })

    for (let index = 0; index < 3; index++) await harness.send()

    expect(await harness.pageviewLogs()).toHaveLength(2)

    expect(harness.counted('analytics_events_dropped_total')).toMatchObject([
      { labels: { reason: 'rate_limited' }, value: 1 },
    ])
  })

  test("never logs or counts the visitor's address", async () => {
    const harness = createHarness()

    await harness.send()
    await harness.send({ ...siteHeaders, 'x-visitor-user-agent': 'Googlebot/2.1' })
    await harness.telemetry.flush(1_000)

    const everything = JSON.stringify({ logs: harness.sink.records, metrics: harness.telemetry.metrics.snapshot() })

    expect(everything).not.toContain(visitorAddress)
  })
})
