import { statusClassOf } from '@brawltome/telemetry'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  AlwaysOnSampler,
  NodeTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { webTelemetry } from './web-telemetry-registry'

const NEXT_REQUEST_SPAN = 'BaseServer.handleRequest'
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])

type WebRoute = 'metrics' | 'api' | 'web'

function normalizeNextRoute(value: unknown): WebRoute {
  if (value === '/api/metrics') return 'metrics'
  if (typeof value === 'string' && value.startsWith('/api/')) return 'api'
  return 'web'
}

function durationMs(span: ReadableSpan): number {
  return span.duration[0] * 1_000 + span.duration[1] / 1_000_000
}

export function createNextRequestSpanProcessor(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnd: (span) => {
      try {
        if (span.attributes['next.span_type'] !== NEXT_REQUEST_SPAN) return
        const method = span.attributes['http.method']
        if (typeof method !== 'string' || !methods.has(method)) return
        const route = normalizeNextRoute(span.attributes['next.route'] ?? span.attributes['http.route'])
        const status = span.attributes['http.status_code']
        const elapsedMs = durationMs(span)
        const attributes = { method, route, durationMs: elapsedMs }

        if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
          if (span.status.code === SpanStatusCode.ERROR) {
            webTelemetry.logger.error('web.request.failed', new Error('Next request failed'), attributes)
          } else {
            webTelemetry.logger.info('web.request.completed_without_status', attributes)
          }
          return
        }

        const labels = { runtime: 'web', method, route, status_class: statusClassOf(status) }
        webTelemetry.metrics.add('http_server_requests_total', 1, labels)
        webTelemetry.metrics.observe('http_server_duration_ms', elapsedMs, labels)
        if (status >= 500 || span.status.code === SpanStatusCode.ERROR) {
          webTelemetry.logger.error('web.request.failed', new Error('Next request failed'), { ...attributes, status })
        } else {
          webTelemetry.logger.info('web.request.completed', { ...attributes, status })
        }
      } catch (error) {
        webTelemetry.logger.error('web.span_processor.failed', error)
      }
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  }
}

const globalProvider = globalThis as typeof globalThis & {
  __brawltomeWebTracerProvider?: NodeTracerProvider
}

export function registerNextNodeTelemetry(): void {
  if (globalProvider.__brawltomeWebTracerProvider) return
  const provider = new NodeTracerProvider({
    sampler: new AlwaysOnSampler(),
    forceFlushTimeoutMillis: 250,
    spanLimits: {
      attributeCountLimit: 32,
      attributeValueLengthLimit: 256,
      eventCountLimit: 8,
      linkCountLimit: 0,
      attributePerEventCountLimit: 8,
      attributePerLinkCountLimit: 0,
    },
    spanProcessors: [createNextRequestSpanProcessor()],
  })
  provider.register()
  globalProvider.__brawltomeWebTracerProvider = provider
}

export function recordNextRequestError(error: unknown): void {
  webTelemetry.logger.error('web.request.failed', error)
}
