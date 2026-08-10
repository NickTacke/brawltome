import type { Context } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type ReadableSpan,
  type Sampler,
  type Span,
  type SpanExporter,
  type SpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { type Telemetry, createFanoutSink, createJsonConsoleSink, createOtlpHttpSink, createTelemetry } from './index'
import { otlpSignalUrl } from './otlp'

const defaultTraceLimits = {
  attributeCountLimit: 32,
  attributeValueLengthLimit: 256,
  eventCountLimit: 8,
  linkCountLimit: 0,
  attributePerEventCountLimit: 8,
  attributePerLinkCountLimit: 0,
} as const

function recordSupportingSpans(sampleRate: number): Sampler {
  const traceSampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) })
  const supportingSpanSampler = new AlwaysOnSampler()

  return {
    shouldSample(context, traceId, spanName, spanKind, attributes, links) {
      const sampler = attributes['brawltome.span'] === true ? traceSampler : supportingSpanSampler
      return sampler.shouldSample(context, traceId, spanName, spanKind, attributes, links)
    },
    toString: () => `RecordSupportingSpans{traceSampler=${traceSampler.toString()}}`,
  }
}

function exportingBrawltomeSpans(processor: SpanProcessor): SpanProcessor {
  const marked = (span: Span | ReadableSpan) => span.attributes['brawltome.span'] === true
  return {
    onStart(span: Span, parentContext: Context) {
      if (marked(span)) processor.onStart(span, parentContext)
    },
    onEnding(span: Span) {
      if (marked(span)) processor.onEnding?.(span)
    },
    onEnd(span: ReadableSpan) {
      if (marked(span)) processor.onEnd(span)
    },
    forceFlush: () => processor.forceFlush(),
    shutdown: () => processor.shutdown(),
  }
}

type TraceProviderOptions = {
  service: string
  sampleRate: number
  exportTimeoutMs?: number
  spanProcessors?: readonly SpanProcessor[]
  headers?: Readonly<Record<string, string>>
} & ({ endpoint: string; exporter?: never } | { endpoint?: never; exporter: SpanExporter })

export function createBrawltomeTraceProvider(options: TraceProviderOptions): NodeTracerProvider {
  const exportTimeoutMs = Math.max(1, Math.min(options.exportTimeoutMs ?? 250, 5_000))
  if (!options.exporter && !options.endpoint) throw new Error('Trace provider requires an endpoint or exporter')
  const exporter =
    options.exporter ??
    new OTLPTraceExporter({
      url: otlpSignalUrl(options.endpoint, 'traces').toString(),
      timeoutMillis: exportTimeoutMs,
      headers: options.headers,
    })
  const processor = exportingBrawltomeSpans(
    new BatchSpanProcessor(exporter, {
      maxQueueSize: 256,
      maxExportBatchSize: 64,
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: exportTimeoutMs,
    }),
  )
  return new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': options.service.slice(0, 80) }),
    sampler: recordSupportingSpans(Math.max(0, Math.min(options.sampleRate, 1))),
    forceFlushTimeoutMillis: exportTimeoutMs,
    spanLimits: defaultTraceLimits,
    spanProcessors: [...(options.spanProcessors ?? []), processor],
  })
}

async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(1, timeoutMs))
    }),
  ])
  if (timer) clearTimeout(timer)
}

export function createNodeRuntimeTelemetry(options: {
  service: string
  endpoint?: string
  capacity?: number
  maxSeriesPerMetric?: number
  drainIntervalMs?: number
  exportTimeoutMs?: number
  sampleRate?: number
  authorization?: string
}): Telemetry {
  const endpoint = options.endpoint?.trim() || undefined
  const exportTimeoutMs = Math.max(1, Math.min(options.exportTimeoutMs ?? 250, 5_000))
  const sampleRate = Math.max(0, Math.min(options.sampleRate ?? 0.1, 1))
  let provider: NodeTracerProvider | undefined
  const headers = options.authorization?.trim() ? { authorization: options.authorization.trim() } : undefined
  const consoleSink = createJsonConsoleSink()
  let sink = consoleSink
  if (endpoint) {
    try {
      provider = createBrawltomeTraceProvider({
        service: options.service,
        sampleRate,
        endpoint,
        exportTimeoutMs,
        headers,
      })
      provider.register()
      sink = createFanoutSink([consoleSink, createOtlpHttpSink({ endpoint, headers })])
    } catch {
      provider = undefined
      sink = consoleSink
    }
  }
  const telemetry = createTelemetry({
    ...options,
    sampleRate,
    exportTimeoutMs,
    sink,
    tracer: provider?.getTracer('@brawltome/telemetry'),
  })
  const shutdownTelemetry = telemetry.shutdown

  return {
    ...telemetry,
    shutdown: async (deadlineMs: number) => {
      const deadline = Date.now() + Math.max(0, deadlineMs)
      await shutdownTelemetry(Math.max(1, deadline - Date.now()))
      if (!provider) return
      await settleWithin(provider.forceFlush(), Math.max(1, deadline - Date.now()))
      await settleWithin(provider.shutdown(), Math.max(1, deadline - Date.now()))
    },
  }
}
