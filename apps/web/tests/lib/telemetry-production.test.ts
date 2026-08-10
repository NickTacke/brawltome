import { describe, expect, test } from 'bun:test'
import { SpanKind } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

describe('web production telemetry registry', () => {
  test('puts a completed normal Next Node request observation in the protected scrape', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousSecret = process.env.INTERNAL_API_SECRET
    Reflect.set(process.env, 'NODE_ENV', 'production')
    Reflect.set(process.env, 'INTERNAL_API_SECRET', 'production-smoke-secret')
    try {
      const { createNextRequestSpanProcessor } = await import('../../src/lib/next-node-telemetry')
      const provider = new NodeTracerProvider({ spanProcessors: [createNextRequestSpanProcessor()] })
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
      const response = await GET(
        new Request('http://web/api/metrics', {
          headers: { 'x-internal-secret': 'production-smoke-secret' },
        }),
      )
      const output = await response.text()

      expect(unauthorized.status).toBe(401)
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
      if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'INTERNAL_API_SECRET')
      else Reflect.set(process.env, 'INTERNAL_API_SECRET', previousSecret)
    }
  })
})
