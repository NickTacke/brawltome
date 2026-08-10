import { describe, expect, test } from 'bun:test'
import { createOtlpHttpSink } from '../src/index'
import { createTelemetry } from '../src/index'
import { createBrawltomeTraceProvider, createNodeRuntimeTelemetry } from '../src/node'

const record = {
  schema: 1 as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  service: 'api',
  level: 'error' as const,
  event: 'refresh.request.failed',
  requestId: 'request-1',
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  attributes: { kind: 'interactive-player-refresh' },
  error: { name: 'Error', message: 'redacted failure' },
}

describe('OTLP telemetry export', () => {
  test('exports normalized records over OTLP HTTP without promoting correlation IDs to resource labels', async () => {
    let payload: unknown
    const captured = { authorization: null as string | null }
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        captured.authorization = request.headers.get('authorization')
        payload = await request.json()
        return new Response(null, { status: 200 })
      },
    })

    try {
      const sink = createOtlpHttpSink({
        endpoint: `http://127.0.0.1:${server.port}`,
        headers: { authorization: 'Bearer local-test' },
      })
      await sink.export([record], AbortSignal.timeout(1_000))

      const resourceLogs = (
        payload as {
          resourceLogs: Array<{
            resource: { attributes: unknown[] }
            scopeLogs: Array<{
              logRecords: Array<{ traceId?: string; spanId?: string; body: { stringValue: string } }>
            }>
          }>
        }
      ).resourceLogs
      const resourceLog = resourceLogs[0]
      const logRecord = resourceLog?.scopeLogs[0]?.logRecords[0]

      expect(captured.authorization).toBe('Bearer local-test')
      expect(resourceLogs).toHaveLength(1)
      expect(resourceLog?.resource.attributes).toEqual([
        { key: 'service.name', value: { stringValue: record.service } },
      ])
      expect(logRecord?.traceId).toBe(record.traceId)
      expect(logRecord?.spanId).toBe(record.spanId)
      expect(JSON.parse(logRecord?.body.stringValue ?? '{}')).toMatchObject(record)
    } finally {
      server.stop(true)
    }
  })

  test('falls back to bounded stdout telemetry when the OTLP endpoint is invalid', async () => {
    const telemetry = createNodeRuntimeTelemetry({
      service: 'api',
      endpoint: 'https://embedded:credential@collector.invalid',
      drainIntervalMs: 0,
    })

    expect(() => telemetry.logger.info('api.started')).not.toThrow()
    expect(telemetry.stats().queued).toBe(1)
    await telemetry.shutdown(50)
  })

  test('rejects a trace provider without an endpoint or exporter explicitly', () => {
    expect(() => createBrawltomeTraceProvider({ service: 'api', sampleRate: 1 } as never)).toThrow(
      'Trace provider requires an endpoint or exporter',
    )
  })

  test('exports only marked BrawlTome spans and preserves an incoming remote parent', async () => {
    const exported: Array<{ name: string; parentSpanContext?: { traceId: string; spanId: string } }> = []
    const provider = createBrawltomeTraceProvider({
      service: 'api',
      sampleRate: 1,
      exporter: {
        export(spans, callback) {
          exported.push(...(spans as typeof exported))
          callback({ code: 0 })
        },
        shutdown: async () => undefined,
      },
    })
    const telemetry = createTelemetry({
      service: 'api',
      drainIntervalMs: 0,
      tracer: provider.getTracer('@brawltome/telemetry'),
    })
    const incoming = telemetry.contextFromHeaders(
      { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, 'x-request-id': 'request-1' },
      { acceptIncoming: true },
    )

    await telemetry.run(incoming, () => telemetry.trace('source.call', { domain: 'api' }, async () => undefined))
    provider
      .getTracer('next')
      .startSpan('GET /player/123', { attributes: { 'next.route': '/player/123' } })
      .end()
    await provider.forceFlush()

    expect(exported).toHaveLength(1)
    expect(exported[0]?.name).toBe('source.call')
    expect(exported[0]?.parentSpanContext).toMatchObject({ traceId: incoming.traceId, spanId: incoming.spanId })
    await provider.shutdown()
  })
})
