import { describe, expect, test } from 'bun:test'
import type { PlayerRefreshSettled } from '@brawltome/refresh-operations'
import { createTelemetry, renderPrometheus } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { type RefreshEventStreamsOptions, createRefreshEventStreams } from '../src/refresh-event-streams'
import { createRefreshEventRoutes } from '../src/routes/refresh-events.routes'

function fakeSource() {
  const source = {
    listens: 0,
    unlistens: 0,
    fail: false,
    onSettled: undefined as ((event: PlayerRefreshSettled) => void) | undefined,
    onListen: undefined as (() => void) | undefined,
    async listenPlayerRefreshSettled(onSettled: (event: PlayerRefreshSettled) => void, onListen?: () => void) {
      source.listens++
      if (source.fail) throw new Error('listen failed')
      source.onSettled = onSettled
      source.onListen = onListen
      onListen?.()
      return {
        unlisten: async () => {
          source.unlistens++
        },
      }
    },
    settle(event: PlayerRefreshSettled) {
      source.onSettled?.(event)
    },
  }
  return source
}

function setup(overrides: Partial<Omit<RefreshEventStreamsOptions, 'source' | 'telemetry'>> = {}) {
  const source = fakeSource()
  const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
  const streams = createRefreshEventStreams({ source, telemetry, ...overrides })
  const app = new Hono()
  app.use('/*', cors({ origin: (origin) => (origin === 'https://brawltome.app' ? origin : null), credentials: true }))
  app.route('/events', createRefreshEventRoutes(streams))
  const open = (id: number | string, ip = '203.0.113.7', init: RequestInit = {}) =>
    app.request(`/events/player/${id}/refresh`, {
      ...init,
      headers: { 'x-client-ip': ip, origin: 'https://brawltome.app', ...init.headers },
    })
  const metrics = () => renderPrometheus(telemetry.metrics.snapshot())
  return { source, streams, open, metrics }
}

const decoder = new TextDecoder()

function reader(response: Response) {
  if (!response.body) throw new Error('Expected a streaming body')
  const stream = response.body.getReader()
  let text = ''
  let done = false
  return {
    get text() {
      return text
    },
    get done() {
      return done
    },
    async until(predicate: (text: string) => boolean, timeoutMs = 1_000): Promise<string> {
      const deadline = Date.now() + timeoutMs
      while (!predicate(text)) {
        if (done) throw new Error(`stream ended before expectation; received ${JSON.stringify(text)}`)
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(`timed out; received ${JSON.stringify(text)}`)
        let timer: ReturnType<typeof setTimeout> | undefined
        const chunk = await Promise.race([
          stream.read(),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), remaining)
          }),
        ])
        clearTimeout(timer)
        if (chunk === 'timeout') continue
        if (chunk.done) done = true
        else text += decoder.decode(chunk.value, { stream: true })
      }
      return text
    },
    async ended(timeoutMs = 1_000): Promise<string> {
      const deadline = Date.now() + timeoutMs
      while (!done) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error(`stream still open; received ${JSON.stringify(text)}`)
        let timer: ReturnType<typeof setTimeout> | undefined
        const chunk = await Promise.race([
          stream.read(),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), remaining)
          }),
        ])
        clearTimeout(timer)
        if (chunk === 'timeout') continue
        if (chunk.done) done = true
        else text += decoder.decode(chunk.value, { stream: true })
      }
      return text
    },
    cancel: () => stream.cancel(),
  }
}

describe('refresh event streams', () => {
  test('announces readiness, then pushes the settlement for its player and ends the stream', async () => {
    const { source, streams, open, metrics } = setup()
    const response = await open(42)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(response.headers.get('access-control-allow-origin')).toBe('https://brawltome.app')
    const stream = reader(response)
    expect(await stream.until((text) => text.includes('event: ready'))).toBe('retry: 2000\nevent: ready\ndata: {}\n\n')

    source.settle({ operationId: 'other', brawlhallaId: 7, status: 'succeeded' })
    source.settle({ operationId: 'op-1', brawlhallaId: 42, status: 'succeeded' })
    const text = await stream.ended()
    expect(text).toContain('event: settled\ndata: {"status":"succeeded","operationId":"op-1"}\n\n')
    expect(text).not.toContain('"other"')
    expect(streams.openStreams).toBe(0)
    expect(metrics()).toContain('refresh_event_streams_total{outcome="opened"} 1')
    expect(metrics()).toContain('refresh_events_delivered_total{event="succeeded"} 1')
    expect(metrics()).toContain('refresh_event_streams_closed_total{reason="settled"} 1')
  })

  test('pushes dead-lettered refreshes so the page stops waiting', async () => {
    const { source, open, metrics } = setup()
    const stream = reader(await open(42))
    await stream.until((text) => text.includes('event: ready'))
    source.settle({ operationId: 'op-2', brawlhallaId: 42, status: 'dead_letter' })
    expect(await stream.ended()).toContain('data: {"status":"dead_letter","operationId":"op-2"}')
    expect(metrics()).toContain('refresh_events_delivered_total{event="dead_letter"} 1')
  })

  test('shares one LISTEN across every stream in the process', async () => {
    const { source, streams, open } = setup()
    const first = reader(await open(42, '203.0.113.1'))
    const second = reader(await open(42, '203.0.113.2'))
    const third = reader(await open(9, '203.0.113.3'))
    expect(source.listens).toBe(1)
    expect(streams.openStreams).toBe(3)
    source.settle({ operationId: 'op-3', brawlhallaId: 42, status: 'succeeded' })
    expect(await first.ended()).toContain('event: settled')
    expect(await second.ended()).toContain('event: settled')
    expect(streams.openStreams).toBe(1)
    await third.cancel()
  })

  test('releases the LISTEN once no stream has been open for a while, and listens again on demand', async () => {
    const { source, streams, open } = setup({ idleReleaseMs: 20 })
    const first = reader(await open(42))
    await first.until((text) => text.includes('event: ready'))
    await first.cancel()
    const second = reader(await open(42))
    await second.until((text) => text.includes('event: ready'))
    await second.cancel()
    expect(source.listens).toBe(1)
    await Bun.sleep(60)
    expect(source.unlistens).toBe(1)
    const third = reader(await open(42))
    await third.until((text) => text.includes('event: ready'))
    expect(source.listens).toBe(2)
    await streams.close()
    expect(source.unlistens).toBe(2)
  })

  test('writes keep-alive comments while waiting', async () => {
    const { streams, open } = setup({ keepAliveMs: 20 })
    const stream = reader(await open(42))
    const text = await stream.until((value) => value.split(': keep-alive\n\n').length > 2)
    expect(text.startsWith('retry: 2000\nevent: ready')).toBe(true)
    streams.drain()
  })

  test('ends a stream after its maximum lifetime so the browser reconnects', async () => {
    const { streams, open, metrics } = setup({ maxStreamMs: 30 })
    const stream = reader(await open(42))
    expect(await stream.ended()).toBe('retry: 2000\nevent: ready\ndata: {}\n\n')
    expect(streams.openStreams).toBe(0)
    expect(metrics()).toContain('refresh_event_streams_closed_total{reason="expired"} 1')
  })

  test('caps streams per client and per process', async () => {
    const { streams, open, metrics } = setup({ maxStreams: 3, maxStreamsPerClient: 2 })
    expect((await open(1, '203.0.113.1')).status).toBe(200)
    expect((await open(2, '203.0.113.1')).status).toBe(200)
    const perClient = await open(3, '203.0.113.1')
    expect(perClient.status).toBe(429)
    expect(await perClient.json()).toEqual({ error: 'too_many_event_streams' })
    expect(perClient.headers.get('retry-after')).toBe('30')

    expect((await open(3, '203.0.113.2')).status).toBe(200)
    expect((await open(4, '203.0.113.3')).status).toBe(429)
    expect(streams.openStreams).toBe(3)
    expect(metrics()).toContain('refresh_event_streams_total{outcome="rejected_client"} 1')
    expect(metrics()).toContain('refresh_event_streams_total{outcome="rejected_capacity"} 1')
    streams.drain()
  })

  test('frees the slot when the client goes away', async () => {
    const { streams, open, metrics } = setup({ maxStreamsPerClient: 1 })
    const stream = reader(await open(42))
    await stream.until((text) => text.includes('event: ready'))
    await stream.cancel()
    expect(streams.openStreams).toBe(0)
    expect(metrics()).toContain('refresh_event_streams_closed_total{reason="client"} 1')
    expect((await open(42)).status).toBe(200)
    streams.drain()
  })

  test('frees the slot when the request is aborted', async () => {
    const { streams, open } = setup({ maxStreamsPerClient: 1 })
    const controller = new AbortController()
    const response = await open(42, '203.0.113.7', { signal: controller.signal })
    expect(response.status).toBe(200)
    expect(streams.openStreams).toBe(1)
    controller.abort()
    expect(streams.openStreams).toBe(0)
  })

  test('ends open streams on drain and answers new ones with a reconnect hint', async () => {
    const { streams, open, metrics } = setup()
    const first = reader(await open(42, '203.0.113.1'))
    const second = reader(await open(9, '203.0.113.2'))
    await first.until((text) => text.includes('event: ready'))
    streams.drain()
    expect(await first.ended()).toBe('retry: 2000\nevent: ready\ndata: {}\n\n')
    await second.ended()
    expect(streams.openStreams).toBe(0)

    const during = await open(42)
    expect(during.status).toBe(200)
    expect(await during.text()).toBe('retry: 2000\n\n')
    expect(streams.openStreams).toBe(0)
    expect(metrics()).toContain('refresh_event_streams_closed_total{reason="draining"} 2')
    expect(metrics()).toContain('refresh_event_streams_total{outcome="draining"} 1')
  })

  test('asks every open page to refetch after the LISTEN connection reconnects', async () => {
    const { source, streams, open, metrics } = setup()
    const stream = reader(await open(42))
    await stream.until((text) => text.includes('event: ready'))
    source.onListen?.()
    expect(await stream.until((text) => text.includes('event: resync'))).toContain('event: resync\ndata: {}\n\n')
    expect(metrics()).toContain('refresh_events_delivered_total{event="resync"} 1')
    streams.drain()
  })

  test('reports the stream unavailable when LISTEN fails, then retries LISTEN on the next request', async () => {
    const { source, streams, open, metrics } = setup()
    source.fail = true
    const failed = await open(42)
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'refresh_events_unavailable' })
    expect(metrics()).toContain('refresh_event_streams_total{outcome="unavailable"} 1')
    source.fail = false
    expect((await open(42)).status).toBe(200)
    expect(source.listens).toBe(2)
    await streams.close()
    expect(source.unlistens).toBe(1)
  })

  test('rejects malformed player ids without opening a stream', async () => {
    const { source, open } = setup()
    for (const id of ['0', '-1', 'abc', '1.5', '99999999999999999999']) {
      expect((await open(id)).status).toBe(400)
    }
    expect(source.listens).toBe(0)
  })
})
