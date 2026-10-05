import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { BhApiClient } from '../src/client'

let server: ReturnType<typeof Bun.serve>
let baseUrl = ''

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path.includes('/player/42/ranked')) return Response.json({ brawlhalla_id: 42 })
      if (path.includes('/player/404/ranked')) return new Response(null, { status: 404 })
      if (path.includes('/player/429/ranked')) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
      }
      if (path === '/v1/player/stats') return new Response('unavailable api_key=secret', { status: 503 })
      return new Response('private upstream body token=secret', { status: 500 })
    },
  })
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => server.stop(true))

describe('Brawlhalla source telemetry', () => {
  test('records bounded source outcomes without leaking credentials, URLs, or bodies', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0 })
    const client = new BhApiClient({ apiKey: 'irreplaceable-secret', baseUrl, telemetry })

    await client.getPlayerRanked(42)
    await expect(client.getPlayerRanked(99)).rejects.toThrow('Brawlhalla API error')
    await telemetry.flush(50)

    const output = `${JSON.stringify(telemetry.metrics.snapshot())}${JSON.stringify(sink.records)}`
    expect(output).toContain('brawlhalla-v0')
    expect(output).not.toContain('irreplaceable-secret')
    expect(output).not.toContain('/player/42')
    expect(output).not.toContain('private upstream body')
  })

  test('logs upstream statuses as structured events without query strings or player ids', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'test', sink, drainIntervalMs: 0 })
    const queue = {
      acquire: async () => 0,
      pause: () => undefined,
      remainingOnDemand: 10,
      remainingBackground: 10,
      pausedUntilMs: 0,
    }
    const client = new BhApiClient({ apiKey: 'irreplaceable-secret', baseUrl, telemetry, queue: queue as never })
    const log = console.log
    const warn = console.warn
    const consoleLines: unknown[] = []
    console.log = (...args: unknown[]) => consoleLines.push(args)
    console.warn = (...args: unknown[]) => consoleLines.push(args)
    try {
      await expect(client.getPlayerRanked(404)).resolves.toBeNull()
      await expect(client.getPlayerRanked(429)).rejects.toThrow('rate limited')
      await expect(client.getPlayerStatsV1Payload(77)).rejects.toThrow('Brawlhalla API error')
    } finally {
      console.log = log
      console.warn = warn
    }
    await telemetry.flush(50)

    expect(consoleLines).toEqual([])
    const responses = sink.records.filter((record) => record.event === 'source.call.response')
    expect(responses.map(({ level, attributes }) => ({ level, ...attributes }))).toEqual([
      expect.objectContaining({
        level: 'info',
        domain: 'brawlhalla-v0',
        path: '/player/:id/ranked',
        status: 404,
        outcome: 'not_found',
      }),
      expect.objectContaining({
        level: 'warn',
        domain: 'brawlhalla-v0',
        path: '/player/:id/ranked',
        status: 429,
        outcome: 'rate_limited',
        retryAfterSeconds: 2,
      }),
      expect.objectContaining({
        level: 'warn',
        domain: 'brawlhalla-v1',
        path: '/player/stats',
        status: 503,
        outcome: 'failed',
      }),
    ])
    const output = JSON.stringify(sink.records)
    expect(output).not.toContain('irreplaceable-secret')
    expect(output).not.toContain('api_key')
    expect(output).not.toContain('brawlhalla_id')
    expect(output).not.toContain('/player/404')
  })
})
