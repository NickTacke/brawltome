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

// the day's salt as the database hands it out: the same one however often it is read
function createSaltSource() {
  const salt = randomBytes(32)

  return async () => salt
}

function createHarness({ visitsPerMinute = 120, eventsPerMinute = 120, loadSalt = createSaltSource() } = {}) {
  const sink = createMemorySink()
  const telemetry = createTelemetry({ service: 'api', sink, drainIntervalMs: 0 })
  const visitorKeys = createDailyVisitorKeys({ now: Date.now, loadSalt, readTimeoutMs: 1_000 })
  const limiter = createVisitLimiter(visitsPerMinute, Date.now)
  const eventLimiter = createVisitLimiter(eventsPerMinute, Date.now)
  const visits = createSiteVisitProcedures({ visitorKeys, limiter, eventLimiter })
  const router = createOrpcRouter([], { database: {} as Database }, { visits })
  const app = new Hono()

  app.route('/', createOrpcRoutes({ telemetry, internalSecret, router }))

  // goes through the same address check serve.ts runs before any route
  async function send(headers: Record<string, string> = siteHeaders, body: unknown = visit, path = '/v1/visits') {
    const init = { method: 'POST', headers, body: JSON.stringify(body) }
    const request = new Request(`http://api.test${path}`, init)
    const response = await app.fetch(requestWithVerifiedClientIp(request, siteAddress, internalSecret))

    return { status: response.status, body: await response.json() }
  }

  const sendEvent = (event: unknown, headers: Record<string, string> = siteHeaders) =>
    send(headers, event, '/v1/visits/events')

  async function logs(event: string) {
    await telemetry.flush(1_000)

    return sink.records.filter((record) => record.event === event)
  }

  const pageviewLogs = () => logs('analytics.pageview')

  const counted = (name: string) =>
    telemetry.metrics
      .snapshot()
      .find((metric) => metric.name === name)
      ?.series.map((series) => series) ?? []

  return { send, sendEvent, logs, pageviewLogs, counted, sink, telemetry }
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

  test("drops the view when the day's salt can't be read, and counts again once it can", async () => {
    const salt = randomBytes(32)
    let isDatabaseDown = true

    const harness = createHarness({
      loadSalt: async () => {
        if (isDatabaseDown) throw new Error('connect ECONNREFUSED 127.0.0.1:5432')

        return salt
      },
    })

    expect(await harness.send()).toEqual({ status: 200, body: { recorded: false } })
    expect(await harness.pageviewLogs()).toEqual([])
    expect(harness.counted('analytics_pageviews_total')).toEqual([])

    expect(harness.counted('analytics_events_dropped_total')).toMatchObject([
      { labels: { reason: 'salt_unavailable' }, value: 1 },
    ])

    isDatabaseDown = false

    expect(await harness.send()).toEqual({ status: 200, body: { recorded: true } })
    expect(await harness.pageviewLogs()).toHaveLength(1)
  })

  test('never logs the salt when the read fails with an error that carries it', async () => {
    const salt = randomBytes(32).toString('hex')

    // what a database driver's error can look like: the failed query's parameters in the message and beside it
    const failure = Object.assign(new Error(`insert failed, params: 2026-11-10,${salt}`), { params: [salt] })
    const harness = createHarness({ loadSalt: () => Promise.reject(failure) })

    expect(await harness.send()).toEqual({ status: 200, body: { recorded: false } })
    await harness.telemetry.flush(1_000)

    expect(JSON.stringify(harness.sink.records)).not.toContain(salt)
  })

  test('never logs or counts the salt', async () => {
    const salt = randomBytes(32)
    const harness = createHarness({ loadSalt: async () => salt })

    await harness.send()
    await harness.telemetry.flush(1_000)

    const everything = JSON.stringify({ logs: harness.sink.records, metrics: harness.telemetry.metrics.snapshot() })

    expect(everything).not.toContain(salt.toString('hex'))
    expect(everything).not.toContain(salt.toString('base64'))
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

describe('site event procedure', () => {
  const tab = { visitId: 'b'.repeat(32), path: '/' }
  const found = { query: 'boomie', results: 3, aliasResults: 1, latencyMs: 180 }
  const performed = { ...tab, name: 'search.performed', source: 'bar', ...found }
  const failed = { ...tab, name: 'search.failed', source: 'bar', latencyMs: 5_000 }
  const selected = { ...tab, name: 'search.selected', source: 'bar', position: 2, viaAlias: true }

  test('refuses callers without the internal secret', async () => {
    const harness = createHarness()
    const { 'x-internal-secret': _secret, ...withoutSecret } = siteHeaders

    expect((await harness.sendEvent(performed, withoutSecret)).status).toBe(403)
    expect(await harness.logs('analytics.search.performed')).toEqual([])
  })

  test('counts a search that found something as a hit, with its latency', async () => {
    const harness = createHarness()

    expect(await harness.sendEvent(performed)).toEqual({ status: 200, body: { recorded: true } })

    const [log] = await harness.logs('analytics.search.performed')
    const { visitId, ...attributes } = log.attributes ?? {}

    expect(attributes).toEqual({ route: '/', source: 'bar', ...found })

    expect(visitId).toMatch(/^[0-9a-f]{32}$/)
    expect(visitId).not.toBe(tab.visitId)

    expect(harness.counted('analytics_searches_total')).toMatchObject([
      { labels: { outcome: 'hit', source: 'bar' }, value: 1 },
    ])

    expect(harness.counted('analytics_search_latency_ms')).toMatchObject([
      { labels: { source: 'bar' }, count: 1, sum: 180 },
    ])
  })

  test('counts a search that found nothing as a miss', async () => {
    const harness = createHarness()

    await harness.sendEvent({ ...performed, results: 0, aliasResults: 0 })

    expect(harness.counted('analytics_searches_total')).toMatchObject([
      { labels: { outcome: 'miss', source: 'bar' }, value: 1 },
    ])
  })

  test('scrubs the query before it is logged, and never puts it in a metric', async () => {
    const harness = createHarness()

    await harness.sendEvent({ ...performed, query: '  mail me@example.com   from 203.0.113.42 ' })

    const [log] = await harness.logs('analytics.search.performed')

    expect(log.attributes?.query).toBe('mail [email] from [ip]')
    expect(JSON.stringify(harness.telemetry.metrics.snapshot())).not.toContain('mail')
  })

  test('counts a failed search as an error, without a latency sample', async () => {
    const harness = createHarness()

    await harness.sendEvent(failed)

    const [log] = await harness.logs('analytics.search.failed')

    expect(log.attributes).toMatchObject({ route: '/', source: 'bar', latencyMs: 5_000 })

    expect(harness.counted('analytics_searches_total')).toMatchObject([
      { labels: { outcome: 'error', source: 'bar' }, value: 1 },
    ])

    expect(harness.counted('analytics_search_latency_ms')).toEqual([])
  })

  test('counts a picked result, and whether an old name found it', async () => {
    const harness = createHarness()

    await harness.sendEvent(selected)
    await harness.sendEvent({ ...selected, viaAlias: false })

    const [log] = await harness.logs('analytics.search.selected')

    expect(log.attributes).toMatchObject({ route: '/', source: 'bar', position: 2, viaAlias: true })

    expect(harness.counted('analytics_search_selections_total')).toMatchObject([
      { labels: { via_alias: 'true', source: 'bar' }, value: 1 },
      { labels: { via_alias: 'false', source: 'bar' }, value: 1 },
    ])
  })

  describe('web vitals', () => {
    const vital = { ...tab, path: '/player/7', name: 'vitals', metric: 'LCP', value: 1834.5, viewportWidth: 390 }

    test('observes a web vital under its name, route and the device its viewport makes it', async () => {
      const harness = createHarness()

      expect(await harness.sendEvent(vital)).toEqual({ status: 200, body: { recorded: true } })
      await harness.sendEvent({ ...vital, metric: 'CLS', value: 0.08, viewportWidth: 800 })
      await harness.sendEvent({ ...vital, metric: 'INP', value: 96, viewportWidth: 1280 })
      await harness.sendEvent({ ...vital, metric: 'TTFB', value: 240, viewportWidth: 1280 })

      const route = '/player/[id]'

      expect(harness.counted('analytics_web_vitals')).toMatchObject([
        { labels: { name: 'LCP', route, device: 'mobile' }, count: 1, sum: 1834.5 },
        { labels: { name: 'CLS', route, device: 'tablet' }, count: 1, sum: 0.08 },
        { labels: { name: 'INP', route, device: 'desktop' }, count: 1, sum: 96 },
        { labels: { name: 'TTFB', route, device: 'desktop' }, count: 1, sum: 240 },
      ])
    })

    test('refuses a web vital that brings its own device', async () => {
      const harness = createHarness()

      expect((await harness.sendEvent({ ...vital, device: 'desktop' })).status).toBe(400)
      expect(harness.counted('analytics_web_vitals')).toEqual([])
    })

    test('refuses a metric the dashboards do not show and a value out of range', async () => {
      const harness = createHarness()

      expect((await harness.sendEvent({ ...vital, metric: 'FCP' })).status).toBe(400)
      expect((await harness.sendEvent({ ...vital, value: 600_001 })).status).toBe(400)
      expect((await harness.sendEvent({ ...vital, value: -1 })).status).toBe(400)
      expect(harness.counted('analytics_web_vitals')).toEqual([])
    })

    test('drops the web vitals of a bot', async () => {
      const harness = createHarness()
      const asBot = { ...siteHeaders, 'x-visitor-user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome-Lighthouse' }

      expect((await harness.sendEvent(vital, asBot)).body).toEqual({ recorded: false })
      expect(harness.counted('analytics_web_vitals')).toEqual([])
      expect(harness.counted('analytics_events_dropped_total')).toMatchObject([{ labels: { reason: 'bot' }, value: 1 }])
    })

    test('drops web vitals over the per visitor budget', async () => {
      const harness = createHarness({ eventsPerMinute: 4 })

      for (let index = 0; index < 5; index++) await harness.sendEvent(vital)

      expect(harness.counted('analytics_web_vitals')).toMatchObject([{ count: 4 }])

      expect(harness.counted('analytics_events_dropped_total')).toMatchObject([
        { labels: { reason: 'rate_limited' }, value: 1 },
      ])
    })

    test("logs nothing for a web vital, so neither the tab nor the visitor's address", async () => {
      const harness = createHarness()

      await harness.sendEvent(vital)
      await harness.telemetry.flush(1_000)

      const everything = JSON.stringify({ logs: harness.sink.records, metrics: harness.telemetry.metrics.snapshot() })

      expect(harness.sink.records.filter((record) => record.event?.startsWith('analytics.'))).toEqual([])
      expect(everything).not.toContain(visitorAddress)
      expect(everything).not.toContain(vital.visitId)
    })
  })

  describe('errors in the browser', () => {
    const thrown = { kind: 'unhandled', message: 'x is not a function' }
    const clientError = { ...tab, path: '/guild/9', name: 'error.client', ...thrown }
    const errorLogs = (harness: ReturnType<typeof createHarness>) => harness.logs('analytics.error.client')

    test('counts an error under its kind and route, and logs its message', async () => {
      const harness = createHarness()

      expect(await harness.sendEvent(clientError)).toEqual({ status: 200, body: { recorded: true } })
      await harness.sendEvent({ ...clientError, kind: 'render' })
      await harness.sendEvent({ ...clientError, kind: 'rejection' })

      const [log] = await errorLogs(harness)
      const { visitId, ...attributes } = log.attributes ?? {}

      expect(attributes).toEqual({ route: '/guild/[id]', ...thrown })

      expect(visitId).toMatch(/^[0-9a-f]{32}$/)
      expect(visitId).not.toBe(tab.visitId)

      expect(harness.counted('analytics_client_errors_total')).toMatchObject([
        { labels: { kind: 'unhandled', route: '/guild/[id]' }, value: 1 },
        { labels: { kind: 'render', route: '/guild/[id]' }, value: 1 },
        { labels: { kind: 'rejection', route: '/guild/[id]' }, value: 1 },
      ])
    })

    test('scrubs the message before it is logged, and never puts it in a metric', async () => {
      const harness = createHarness()
      const message = 'load https://api.test/player/7?api_key=SECRET for me@example.com from 203.0.113.42 failed'

      await harness.sendEvent({ ...clientError, message })

      const [log] = await errorLogs(harness)

      expect(log.attributes?.message).toBe('load [url] for [email] from [ip] failed')
      expect(JSON.stringify(harness.telemetry.metrics.snapshot())).not.toContain('failed')
    })

    test('logs no more than the first 200 characters of a message', async () => {
      const harness = createHarness()

      await harness.sendEvent({ ...clientError, message: 'm'.repeat(1000) })

      const [log] = await errorLogs(harness)

      expect(log.attributes?.message).toBe('m'.repeat(200))
    })

    test('refuses an error of an unknown kind, with a longer message or with a field it does not know', async () => {
      const harness = createHarness()

      expect((await harness.sendEvent({ ...clientError, kind: 'network' })).status).toBe(400)
      expect((await harness.sendEvent({ ...clientError, message: 'm'.repeat(1001) })).status).toBe(400)
      expect((await harness.sendEvent({ ...clientError, stack: 'at render (app.js:1:1)' })).status).toBe(400)
      expect(await errorLogs(harness)).toEqual([])
      expect(harness.counted('analytics_client_errors_total')).toEqual([])
    })

    test('drops the errors of a bot', async () => {
      const harness = createHarness()
      const asBot = { ...siteHeaders, 'x-visitor-user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }

      expect((await harness.sendEvent(clientError, asBot)).body).toEqual({ recorded: false })
      expect(await errorLogs(harness)).toEqual([])
      expect(harness.counted('analytics_client_errors_total')).toEqual([])
      expect(harness.counted('analytics_events_dropped_total')).toMatchObject([{ labels: { reason: 'bot' }, value: 1 }])
    })

    test('drops errors over the per visitor budget', async () => {
      const harness = createHarness({ eventsPerMinute: 2 })

      for (let index = 0; index < 3; index++) await harness.sendEvent(clientError)

      expect(await errorLogs(harness)).toHaveLength(2)

      expect(harness.counted('analytics_events_dropped_total')).toMatchObject([
        { labels: { reason: 'rate_limited' }, value: 1 },
      ])
    })

    test("never logs or counts the visitor's address or browser", async () => {
      const harness = createHarness()

      await harness.sendEvent(clientError)
      await harness.telemetry.flush(1_000)

      const everything = JSON.stringify({ logs: harness.sink.records, metrics: harness.telemetry.metrics.snapshot() })

      expect(everything).not.toContain(visitorAddress)
      expect(everything).not.toContain('Safari')
    })
  })

  test('drops a bot', async () => {
    const harness = createHarness()
    const asBot = { ...siteHeaders, 'x-visitor-user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }

    expect((await harness.sendEvent(performed, asBot)).body).toEqual({ recorded: false })
    expect(await harness.logs('analytics.search.performed')).toEqual([])
    expect(harness.counted('analytics_searches_total')).toEqual([])
    expect(harness.counted('analytics_events_dropped_total')).toMatchObject([{ labels: { reason: 'bot' }, value: 1 }])
  })

  test('drops events over the per visitor budget, without using up the page views', async () => {
    const harness = createHarness({ eventsPerMinute: 2 })

    for (let index = 0; index < 3; index++) await harness.sendEvent(performed)

    expect(await harness.logs('analytics.search.performed')).toHaveLength(2)

    expect(harness.counted('analytics_events_dropped_total')).toMatchObject([
      { labels: { reason: 'rate_limited' }, value: 1 },
    ])

    expect((await harness.send()).body).toEqual({ recorded: true })
  })

  test('refuses an event with a field it does not know', async () => {
    const harness = createHarness()

    expect((await harness.sendEvent({ ...performed, ip: visitorAddress })).status).toBe(400)
    expect(await harness.logs('analytics.search.performed')).toEqual([])
  })

  test("never logs or counts the visitor's address", async () => {
    const harness = createHarness()

    for (const event of [performed, failed, selected]) await harness.sendEvent(event)

    await harness.telemetry.flush(1_000)

    const everything = JSON.stringify({ logs: harness.sink.records, metrics: harness.telemetry.metrics.snapshot() })

    expect(everything).not.toContain(visitorAddress)
  })
})
