import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry, instrumentHttpHandler, telemetryFetch } from '../src/index'

describe('HTTP telemetry adapters', () => {
  test('mints public ingress correlation and records bounded route metrics without changing response', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'api', sink, drainIntervalMs: 0, sampleRate: 1 })
    const fetch = instrumentHttpHandler(telemetry, 'api', async () => new Response('ok', { status: 201 }))
    const response = await fetch(
      new Request('http://service/trpc/player.byId?private=value', {
        headers: { 'x-request-id': 'request-42' },
      }),
    )
    await telemetry.flush(50)

    expect(await response.text()).toBe('ok')
    expect(response.headers.get('x-request-id')).not.toBe('request-42')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(
      telemetry.metrics.snapshot().find(({ name }) => name === 'http_server_requests_total')?.series[0],
    ).toMatchObject({
      labels: { runtime: 'api', method: 'GET', route: 'trpc', status_class: '2xx' },
      value: 1,
    })
    expect(JSON.stringify(sink.records)).not.toContain('private=value')
  })

  test('accepts explicitly trusted internal propagation', async () => {
    const telemetry = createTelemetry({ service: 'api', drainIntervalMs: 0 })
    const fetch = instrumentHttpHandler(telemetry, 'api', async () => new Response('ok'), {
      acceptIncoming: (request) => request.headers.get('x-internal-secret') === 'trusted',
    })
    const response = await fetch(
      new Request('http://service/trpc/status', {
        headers: {
          'x-request-id': 'internal-request',
          traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
          'x-internal-secret': 'trusted',
        },
      }),
    )

    expect(response.headers.get('x-request-id')).toBe('internal-request')
  })

  test('outbound propagation and observers are fail-open', async () => {
    const telemetry = createTelemetry({ service: 'web', capacity: 1, drainIntervalMs: 0 })
    const context = telemetry.childContext()
    let headers: Headers | undefined
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return new Response('ok')
    }

    const response = await telemetry.run(context, () =>
      telemetryFetch(telemetry, 'api', fetcher, 'http://api/private?token=no', {}, { propagateContext: true }),
    )
    expect(await response.text()).toBe('ok')
    expect(headers?.get('x-request-id')).toBe(context.requestId)
    expect(headers?.get('traceparent')).toContain(context.traceId)
  })
})
