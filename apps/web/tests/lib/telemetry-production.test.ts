import { describe, expect, test } from 'bun:test'
import { createBrawltomeTraceProvider } from '@brawltome/telemetry/node'
import { SpanKind } from '@opentelemetry/api'

describe('web production telemetry registry', () => {
  test('puts a completed normal Next Node request observation in the protected scrape', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousSecret = process.env.METRICS_SCRAPE_SECRET
    Reflect.set(process.env, 'NODE_ENV', 'production')
    Reflect.set(process.env, 'METRICS_SCRAPE_SECRET', 'production-smoke-secret')
    try {
      const { createNextRequestSpanProcessor } = await import('../../src/lib/next-node-telemetry')
      const provider = createBrawltomeTraceProvider({
        service: 'web',
        sampleRate: 0,
        exporter: {
          export: (_spans, callback) => callback({ code: 0 }),
          shutdown: async () => undefined,
        },
        spanProcessors: [createNextRequestSpanProcessor()],
      })
      const span = provider.getTracer('next-server').startSpan('GET /player/[id]', {
        kind: SpanKind.SERVER,
        attributes: {
          'next.span_type': 'BaseServer.handleRequest',
          'next.route': '/player/[id]',
          'http.method': 'GET',
          'http.status_code': 200,
        },
      })
      span.end()

      const { GET } = await import('../../src/app/api/metrics/route')
      const unauthorized = await GET(new Request('http://web/api/metrics'))
      const broadInternalCredential = await GET(
        new Request('http://web/api/metrics', {
          headers: { 'x-internal-secret': 'production-smoke-secret' },
        }),
      )
      const response = await GET(
        new Request('http://web/api/metrics', {
          headers: { 'x-metrics-secret': 'production-smoke-secret' },
        }),
      )
      const output = await response.text()

      expect(unauthorized.status).toBe(401)
      expect(broadInternalCredential.status).toBe(401)
      expect(response.status).toBe(200)
      expect(output).toContain(
        'http_server_requests_total{method="GET",route="web",runtime="web",status_class="2xx"} 1',
      )
      expect(output).toContain(
        'http_server_duration_ms_count{method="GET",route="web",runtime="web",status_class="2xx"} 1',
      )
      await provider.shutdown()
    } finally {
      if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
      else Reflect.set(process.env, 'NODE_ENV', previousNodeEnv)
      if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'METRICS_SCRAPE_SECRET')
      else Reflect.set(process.env, 'METRICS_SCRAPE_SECRET', previousSecret)
    }
  })
})
