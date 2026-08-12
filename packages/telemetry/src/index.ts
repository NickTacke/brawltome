import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  type Context,
  type Span,
  type SpanContext,
  SpanStatusCode,
  type Tracer,
  isSpanContextValid,
  context as otelContext,
  trace as otelTrace,
} from '@opentelemetry/api'
import { otlpSignalUrl } from './otlp'
import {
  type TelemetryContext,
  type TelemetryIds,
  formatTraceparent,
  parseTraceparent,
  requestContextFromHeaders,
} from './propagation'

export { formatTraceparent, parseTraceparent, requestContextFromHeaders }
export type { TelemetryContext, TelemetryIds }

export type TelemetryScalar = string | number | boolean
export type TelemetryAttributes = Readonly<Record<string, unknown>>

export type TelemetryRecord = Readonly<{
  schema: 1
  timestamp: string
  service: string
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string
  requestId?: string
  traceId?: string
  spanId?: string
  attributes?: Readonly<Record<string, TelemetryScalar>>
  error?: Readonly<{ name: string; message: string }>
}>

export interface TelemetrySink {
  export(records: readonly TelemetryRecord[], signal: AbortSignal): Promise<void>
}

export type MetricName =
  | 'http_server_requests_total'
  | 'http_server_duration_ms'
  | 'operation_attempts_total'
  | 'operation_duration_ms'
  | 'operation_oldest_pending_age_ms'
  | 'operation_dead_letters'
  | 'schedule_lateness_ms'
  | 'schedule_materializations_total'
  | 'schedule_missed_windows_total'
  | 'worker_heartbeat_timestamp_seconds'
  | 'source_calls_total'
  | 'source_duration_ms'
  | 'source_quota_used'
  | 'source_quota_limit'
  | 'refresh_failures_total'
  | 'matchmaking_ingest_total'
  | 'discord_interactions_total'

export type MetricLabels = Readonly<Record<string, string>>

type MetricKind = 'counter' | 'gauge' | 'histogram'
type MetricDefinition = {
  kind: MetricKind
  help: string
  labels: Readonly<Record<string, readonly string[]>>
  buckets?: readonly number[]
}

type MetricSeries = {
  labels: MetricLabels
  value: number
  count?: number
  sum?: number
  buckets?: number[]
}

export type MetricSnapshot = ReadonlyArray<{
  name: MetricName
  definition: MetricDefinition
  series: readonly MetricSeries[]
}>

const runtime = ['api', 'operations-worker', 'web', 'discord'] as const
const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
const route = [
  'trpc',
  'health_live',
  'health_ready',
  'metrics',
  'auth',
  'operations',
  'matches',
  'overlay',
  'web',
  'api',
  'other',
] as const
const statusClass = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const
const workClass = [
  'interactive',
  'primary-monitoring',
  'leaderboard',
  'global-statistics',
  'projection',
  'maintenance',
] as const
const operationKind = [
  'proof',
  'interactive-player-refresh',
  'clan-refresh',
  'ranked-player-pulse',
  'player-discovery-projection',
  'clan-discovery-projection',
  'discovery-reconciliation',
  'leaderboard-1v1',
  'leaderboard-2v2',
  'leaderboard-solo-2v2',
  'leaderboard-3v3',
  'statistics-ranked-collection',
  'statistics-lifetime-collection',
  'statistics-publication',
  'statistics-legend-meta-publication',
] as const
const outcome = [
  'succeeded',
  'retry',
  'dead_letter',
  'lease_lost',
  'failed',
  'admitted',
  'rate_limited',
  'deduplicated',
  'not_found',
] as const
const sourceDomain = ['brawlhalla-v0', 'brawlhalla-v1', 'discord', 'steam', 'turnstile', 'r2', 'api'] as const
const interactionKind = ['command', 'select', 'button'] as const
const command = ['player', 'clan', 'status', 'component', 'unknown'] as const
const failureCategory = [
  'admission_deferred',
  'source_rate_limited',
  'source_timeout',
  'source_unavailable',
  'invalid_payload',
  'dependency',
  'execution',
  'lease_lost',
  'unknown',
] as const

const metricsCatalog: Readonly<Record<MetricName, MetricDefinition>> = {
  http_server_requests_total: {
    kind: 'counter',
    help: 'Completed HTTP requests',
    labels: { runtime, method, route, status_class: statusClass },
  },
  http_server_duration_ms: {
    kind: 'histogram',
    help: 'HTTP request duration in milliseconds',
    labels: { runtime, method, route, status_class: statusClass },
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  },
  operation_attempts_total: {
    kind: 'counter',
    help: 'Durable operation attempts',
    labels: { kind: operationKind, work_class: workClass, outcome },
  },
  operation_duration_ms: {
    kind: 'histogram',
    help: 'Durable operation attempt duration',
    labels: { kind: operationKind, work_class: workClass, outcome },
    buckets: [10, 50, 100, 250, 500, 1000, 5000, 15000, 60000],
  },
  operation_oldest_pending_age_ms: {
    kind: 'gauge',
    help: 'Age of the oldest runnable operation',
    labels: { work_class: workClass },
  },
  operation_dead_letters: {
    kind: 'gauge',
    help: 'Current durable dead letters',
    labels: { work_class: workClass, kind: operationKind },
  },
  schedule_lateness_ms: { kind: 'gauge', help: 'Maximum current schedule lateness', labels: { kind: operationKind } },
  schedule_materializations_total: {
    kind: 'counter',
    help: 'Durable schedule materializations',
    labels: { outcome: ['created', 'idle', 'failed'] },
  },
  schedule_missed_windows_total: {
    kind: 'counter',
    help: 'Missed durable schedule windows',
    labels: { kind: operationKind },
  },
  worker_heartbeat_timestamp_seconds: {
    kind: 'gauge',
    help: 'Last successful worker loop wall-clock timestamp',
    labels: { runtime: ['operations-worker'] },
  },
  source_calls_total: { kind: 'counter', help: 'External source calls', labels: { domain: sourceDomain, outcome } },
  source_duration_ms: {
    kind: 'histogram',
    help: 'External source call duration',
    labels: { domain: sourceDomain, outcome },
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  },
  source_quota_used: { kind: 'gauge', help: 'Current source quota units used', labels: { domain: sourceDomain } },
  source_quota_limit: { kind: 'gauge', help: 'Current source quota unit limit', labels: { domain: sourceDomain } },
  refresh_failures_total: {
    kind: 'counter',
    help: 'Refresh failures',
    labels: { kind: operationKind, failure_category: failureCategory },
  },
  matchmaking_ingest_total: {
    kind: 'counter',
    help: 'Matchmaking replay ingest outcomes',
    labels: {
      outcome: [
        'succeeded',
        'rate_limited',
        'oversize',
        'validation_error',
        'parse_error',
        'rejected',
        'dependency_failure',
      ],
    },
  },
  discord_interactions_total: {
    kind: 'counter',
    help: 'Discord interactions',
    labels: { interaction_kind: interactionKind, command, outcome: ['succeeded', 'failed', 'rejected'] },
  },
}

const forbiddenAttribute =
  /(?:authorization|cookie|token|secret|password|api[_-]?key|payload|body|headers?|url|ip|useragent|user_agent)/i
const secretValue = /(?:bearer\s+\S+|(?:token|secret|password|api[_-]?key)\s*[=:]\s*\S+)/gi
function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

const defaultIds: TelemetryIds = {
  traceId: () => randomHex(16),
  spanId: () => randomHex(8),
  requestId: () => randomUUID(),
}

function redact(value: string): string {
  return value.replace(secretValue, '[REDACTED]').slice(0, 512)
}

function normalizeAttributes(attributes?: TelemetryAttributes): Readonly<Record<string, TelemetryScalar>> | undefined {
  if (!attributes || typeof attributes !== 'object') return undefined
  const output: Record<string, TelemetryScalar> = {}
  let inspected = 0
  for (const key in attributes) {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue
    if (inspected++ >= 24) break
    if (forbiddenAttribute.test(key)) continue
    let value: unknown
    try {
      value = attributes[key]
    } catch {
      continue
    }
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      continue
    }
    output[key.slice(0, 64)] = typeof value === 'string' ? redact(value) : value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

const safeErrorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'RateLimitError',
])

function normalizeError(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: 'Error', message: 'Unknown failure' }
  const name = safeErrorNames.has(error.name) ? error.name : 'Error'
  const message =
    name === 'TimeoutError'
      ? 'Operation timed out'
      : name === 'AbortError'
        ? 'Operation aborted'
        : name === 'RateLimitError'
          ? 'Operation rate limited'
          : 'Operation failed'
  return { name, message }
}

function labelsKey(labels: MetricLabels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

function validLabels(definition: MetricDefinition, labels: MetricLabels): boolean {
  const expected = Object.keys(definition.labels).sort()
  const actual = Object.keys(labels).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) return false
  return expected.every((key) => definition.labels[key].includes(labels[key]))
}

function escapePrometheus(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function renderLabels(labels: MetricLabels, extra?: readonly [string, string][]): string {
  const entries = [...Object.entries(labels), ...(extra ?? [])].sort(([a], [b]) => a.localeCompare(b))
  return entries.length === 0
    ? ''
    : `{${entries.map(([key, value]) => `${key}="${escapePrometheus(value)}"`).join(',')}}`
}

export function renderPrometheus(snapshot: MetricSnapshot): string {
  const lines: string[] = []
  for (const metric of snapshot) {
    lines.push(`# HELP ${metric.name} ${metric.definition.help}`, `# TYPE ${metric.name} ${metric.definition.kind}`)
    for (const series of metric.series) {
      if (metric.definition.kind === 'histogram') {
        let cumulative = 0
        for (let index = 0; index < (metric.definition.buckets?.length ?? 0); index++) {
          cumulative += series.buckets?.[index] ?? 0
          lines.push(
            `${metric.name}_bucket${renderLabels(series.labels, [['le', String(metric.definition.buckets?.[index])]])} ${cumulative}`,
          )
        }
        lines.push(`${metric.name}_bucket${renderLabels(series.labels, [['le', '+Inf']])} ${series.count ?? 0}`)
        lines.push(`${metric.name}_sum${renderLabels(series.labels)} ${series.sum ?? 0}`)
        lines.push(`${metric.name}_count${renderLabels(series.labels)} ${series.count ?? 0}`)
      } else {
        lines.push(`${metric.name}${renderLabels(series.labels)} ${series.value}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

export function createMemorySink(): TelemetrySink & { records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = []
  return {
    records,
    export: async (batch) => {
      records.push(...batch)
    },
  }
}

type JsonConsoleSinkOptions = {
  write?: (line: string) => boolean | undefined
  waitForDrain?: (signal: AbortSignal) => Promise<void>
}

export function createJsonConsoleSink(options: JsonConsoleSinkOptions = {}): TelemetrySink {
  const write = options.write ?? ((line: string) => process.stdout.write(line))
  const waitForDrain =
    options.waitForDrain ??
    ((signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          process.stdout.off('drain', onDrain)
          process.stdout.off('error', onError)
          signal.removeEventListener('abort', onAbort)
        }
        const onDrain = () => {
          cleanup()
          resolve()
        }
        const onError = (error: Error) => {
          cleanup()
          reject(error)
        }
        const onAbort = () => {
          cleanup()
          reject(new DOMException('Telemetry output aborted', 'AbortError'))
        }
        process.stdout.once('drain', onDrain)
        process.stdout.once('error', onError)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }))
  return {
    export: async (records, signal) => {
      for (const record of records) {
        if (signal.aborted) throw new DOMException('Telemetry output aborted', 'AbortError')
        if (write(`${JSON.stringify(record)}\n`) === false) await waitForDrain(signal)
      }
    },
  }
}

function otlpId(hex: string | undefined): string | undefined {
  if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return undefined
  return hex.toLowerCase()
}

export function createOtlpHttpSink(options: {
  endpoint: string
  fetch?: typeof fetch
  headers?: Readonly<Record<string, string>>
}): TelemetrySink {
  const url = otlpSignalUrl(options.endpoint, 'logs')
  const send = options.fetch ?? fetch
  return {
    export: async (records, signal) => {
      if (records.length === 0) return
      const byService = new Map<string, TelemetryRecord[]>()
      for (const record of records) {
        const serviceRecords = byService.get(record.service) ?? []
        serviceRecords.push(record)
        byService.set(record.service, serviceRecords)
      }
      const resourceLogs = Array.from(byService, ([service, serviceRecords]) => ({
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: service } }],
        },
        scopeLogs: [
          {
            scope: { name: '@brawltome/telemetry', version: '1' },
            logRecords: serviceRecords.map((record) => ({
              timeUnixNano: String(BigInt(Date.parse(record.timestamp)) * 1_000_000n),
              observedTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
              severityNumber: { debug: 5, info: 9, warn: 13, error: 17 }[record.level],
              severityText: record.level.toUpperCase(),
              body: { stringValue: JSON.stringify(record) },
              ...(otlpId(record.traceId) ? { traceId: otlpId(record.traceId) } : {}),
              ...(otlpId(record.spanId) ? { spanId: otlpId(record.spanId) } : {}),
              attributes: [
                { key: 'brawltome.schema', value: { intValue: String(record.schema) } },
                { key: 'brawltome.event', value: { stringValue: record.event } },
              ],
            })),
          },
        ],
      }))
      const response = await send(url, {
        method: 'POST',
        headers: { ...options.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ resourceLogs }),
        signal,
      })
      if (!response.ok) throw new Error(`OTLP log export failed (${response.status})`)
    },
  }
}

export function createFanoutSink(sinks: readonly TelemetrySink[]): TelemetrySink {
  if (sinks.length === 0) throw new Error('At least one telemetry sink is required')
  return {
    export: async (records, signal) => {
      const results = await Promise.allSettled(sinks.map((sink) => sink.export(records, signal)))
      if (results.some(({ status }) => status === 'rejected')) throw new Error('One or more telemetry sinks failed')
    },
  }
}

export type Telemetry = ReturnType<typeof createTelemetry>

export function createTelemetry(options: {
  service: string
  sink?: TelemetrySink
  capacity?: number
  maxSeriesPerMetric?: number
  drainIntervalMs?: number
  exportTimeoutMs?: number
  sampleRate?: number
  now?: () => number
  id?: () => string
  tracer?: Tracer
  openTelemetry?: {
    getTracer?: () => Tracer
    active?: () => Context
    setSpanContext?: (context: Context, spanContext: SpanContext) => Context
    setSpan?: (context: Context, span: Span) => Context
    with?: <T>(context: Context, work: () => T) => T
  }
}) {
  const capacity = Math.max(1, Math.min(options.capacity ?? 1000, 10_000))
  const maxSeries = Math.max(1, Math.min(options.maxSeriesPerMetric ?? 128, 1024))
  const drainIntervalMs = Math.max(0, Math.min(options.drainIntervalMs ?? 1000, 60_000))
  const exportTimeoutMs = Math.max(1, Math.min(options.exportTimeoutMs ?? 250, 5_000))
  const sampleRate = Math.max(0, Math.min(options.sampleRate ?? 0.1, 1))
  const now = options.now ?? Date.now
  const generated = options.id
  const ids: TelemetryIds = generated
    ? {
        traceId: () => generated().replaceAll('-', '').padEnd(32, '0').slice(0, 32),
        spanId: () => generated().replaceAll('-', '').padEnd(16, '0').slice(0, 16),
        requestId: generated,
      }
    : defaultIds
  const storage = new AsyncLocalStorage<TelemetryContext>()
  const queue: TelemetryRecord[] = []
  const series = new Map<MetricName, Map<string, MetricSeries>>()
  let dropped = 0
  let exportFailures = 0
  let seriesDropped = 0
  let closed = false
  let activeExport: Promise<void> | undefined
  let activeExportTimedOut = false

  function enqueue(
    level: TelemetryRecord['level'],
    event: string,
    error?: unknown,
    attributes?: TelemetryAttributes,
    attributesNormalized = false,
  ): void {
    try {
      if (closed || queue.length >= capacity) {
        dropped++
        return
      }
      const context = storage.getStore()
      const normalizedAttributes = attributesNormalized
        ? (attributes as Readonly<Record<string, TelemetryScalar>> | undefined)
        : normalizeAttributes(attributes)
      queue.push({
        schema: 1,
        timestamp: new Date(now()).toISOString(),
        service: options.service.slice(0, 80),
        level,
        event: event.slice(0, 120),
        ...(context ? { requestId: context.requestId, traceId: context.traceId, spanId: context.spanId } : {}),
        ...(normalizedAttributes ? { attributes: normalizedAttributes } : {}),
        ...(error !== undefined ? { error: normalizeError(error) } : {}),
      })
    } catch {
      dropped++
    }
  }

  function metric(name: MetricName, value: number, labels: MetricLabels, mode: MetricKind): void {
    try {
      const definition = metricsCatalog[name]
      if (!definition || definition.kind !== mode || !Number.isFinite(value) || !validLabels(definition, labels)) {
        seriesDropped++
        return
      }
      let byLabels = series.get(name)
      if (!byLabels) {
        byLabels = new Map()
        series.set(name, byLabels)
      }
      const key = labelsKey(labels)
      let current = byLabels.get(key)
      if (!current) {
        if (byLabels.size >= maxSeries) {
          seriesDropped++
          return
        }
        current = {
          labels: { ...labels },
          value: 0,
          ...(definition.kind === 'histogram' ? { count: 0, sum: 0, buckets: definition.buckets?.map(() => 0) } : {}),
        }
        byLabels.set(key, current)
      }
      if (mode === 'counter') current.value += value
      else if (mode === 'gauge') current.value = value
      else {
        current.count = (current.count ?? 0) + 1
        current.sum = (current.sum ?? 0) + value
        const bucket = definition.buckets?.findIndex((limit) => value <= limit) ?? -1
        if (bucket >= 0 && current.buckets) current.buckets[bucket]++
      }
    } catch {
      seriesDropped++
    }
  }

  async function drain(deadlineMs: number): Promise<void> {
    if (!options.sink) return
    if (!activeExport && queue.length > 0) {
      const batch = queue.splice(0, Math.min(queue.length, 100))
      const controller = new AbortController()
      activeExportTimedOut = false
      const exportPromise = Promise.resolve()
        .then(() => options.sink?.export(batch, controller.signal))
        .catch(() => {
          if (!activeExportTimedOut) exportFailures++
        })
        .finally(() => {
          if (activeExport === exportPromise) activeExport = undefined
        })
      activeExport = exportPromise
      const timeoutMs = Math.max(1, Math.min(deadlineMs, exportTimeoutMs))
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      void exportPromise.finally(() => clearTimeout(timeout))
    }
    if (!activeExport) return
    const observedExport = activeExport
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      observedExport,
      new Promise<void>((resolve) => {
        timeout = setTimeout(
          () => {
            if (activeExport === observedExport && !activeExportTimedOut) {
              activeExportTimedOut = true
              exportFailures++
            }
            resolve()
          },
          Math.max(1, Math.min(deadlineMs, exportTimeoutMs)),
        )
      }),
    ])
    if (timeout) clearTimeout(timeout)
  }

  const timer = drainIntervalMs > 0 ? setInterval(() => void drain(exportTimeoutMs), drainIntervalMs) : undefined
  timer?.unref?.()

  const metrics = {
    add: (name: MetricName, value: number, labels: MetricLabels) => metric(name, value, labels, 'counter'),
    set: (name: MetricName, value: number, labels: MetricLabels) => metric(name, value, labels, 'gauge'),
    observe: (name: MetricName, value: number, labels: MetricLabels) => metric(name, value, labels, 'histogram'),
    snapshot: (): MetricSnapshot =>
      Array.from(series, ([name, values]) => ({
        name,
        definition: metricsCatalog[name],
        series: Array.from(values.values(), (item) => ({
          ...item,
          labels: { ...item.labels },
          buckets: item.buckets ? [...item.buckets] : undefined,
        })),
      })),
  }

  function childContext(parent?: TelemetryContext): TelemetryContext {
    const traceId = parent?.traceId ?? ids.traceId()
    const sampled = parent?.sampled ?? Number.parseInt(traceId.slice(0, 8), 16) / 0xffffffff < sampleRate
    return {
      requestId: parent?.requestId ?? ids.requestId(),
      traceId,
      spanId: ids.spanId(),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      sampled,
    }
  }

  function contextFromHeaders(
    headers: Readonly<Record<string, string | null | undefined>>,
    contextOptions: { acceptIncoming?: boolean } = {},
  ): TelemetryContext {
    if (contextOptions.acceptIncoming) return requestContextFromHeaders(headers, ids, contextOptions)
    return childContext()
  }

  async function trace<T>(name: string, attributes: TelemetryAttributes, work: () => Promise<T>): Promise<T> {
    let productInvocation: Promise<T> | undefined
    const invokeProduct = (): Promise<T> => {
      productInvocation ??= Promise.resolve().then(work)
      return productInvocation
    }

    try {
      const parent = storage.getStore()
      let localContext = childContext(parent)
      const started = now()
      const callerAttributes = normalizeAttributes(attributes) ?? {}
      const normalized = normalizeAttributes({ 'brawltome.span': true, span: name, ...callerAttributes }) ?? {}
      let span: Span | undefined

      try {
        const tracer =
          options.tracer ??
          (options.openTelemetry?.getTracer ?? (() => otelTrace.getTracer(options.service.slice(0, 80))))()
        try {
          let parentContext = (options.openTelemetry?.active ?? (() => otelContext.active()))()
          if (parent) {
            parentContext = (
              options.openTelemetry?.setSpanContext ??
              ((context, spanContext) => otelTrace.setSpanContext(context, spanContext))
            )(parentContext, {
              traceId: parent.traceId,
              spanId: parent.spanId,
              traceFlags: parent.sampled ? 1 : 0,
              isRemote: true,
            })
          }
          span = tracer.startSpan(name.slice(0, 120), { attributes: normalized }, parentContext)
        } catch {
          span = undefined
        }
      } catch {
        span = undefined
      }

      if (span) {
        try {
          const spanContext = span.spanContext()
          if (isSpanContextValid(spanContext)) {
            localContext = {
              ...localContext,
              traceId: spanContext.traceId,
              spanId: spanContext.spanId,
              ...(parent ? { parentSpanId: parent.spanId } : {}),
              sampled: (spanContext.traceFlags & 1) === 1,
            }
          }
        } catch {
          // Keep locally generated correlation identifiers when the provider cannot expose a valid span context.
        }
      }

      const execute = async (): Promise<T> => {
        if (localContext.sampled) enqueue('debug', 'trace.started', undefined, normalized, true)
        try {
          const result = await invokeProduct()
          try {
            span?.setStatus({ code: SpanStatusCode.OK })
          } catch {
            // Telemetry must never change the product result.
          }
          if (localContext.sampled)
            enqueue(
              'debug',
              'trace.completed',
              undefined,
              normalizeAttributes({ durationMs: now() - started, ...normalized }),
              true,
            )
          return result
        } catch (error) {
          try {
            span?.recordException(error instanceof Error ? error : new Error('Unknown failure'))
          } catch {
            // Error recording is independent from status recording and product error propagation.
          }
          try {
            span?.setStatus({ code: SpanStatusCode.ERROR })
          } catch {
            // Telemetry must preserve the original product error.
          }
          enqueue(
            'error',
            'trace.failed',
            error,
            normalizeAttributes({ durationMs: now() - started, ...normalized }),
            true,
          )
          throw error
        } finally {
          try {
            span?.end()
          } catch {
            // Ending a provider span is fail-open.
          }
        }
      }

      let invocation: Promise<T> | undefined
      const invoke = (): Promise<T> => {
        invocation ??= storage.run(localContext, execute)
        return invocation
      }
      if (!span) return invoke()

      let activeContext: Context
      try {
        activeContext = (options.openTelemetry?.active ?? (() => otelContext.active()))()
      } catch {
        return invoke()
      }
      try {
        activeContext = (
          options.openTelemetry?.setSpan ?? ((context, activeSpan) => otelTrace.setSpan(context, activeSpan))
        )(activeContext, span)
      } catch {
        return invoke()
      }
      try {
        return await (options.openTelemetry?.with ?? ((context, activeWork) => otelContext.with(context, activeWork)))(
          activeContext,
          invoke,
        )
      } catch {
        return invocation ?? invoke()
      }
    } catch {
      return productInvocation ?? invokeProduct()
    }
  }

  async function flush(deadlineMs: number): Promise<void> {
    const deadline = now() + Math.max(0, deadlineMs)
    do {
      await drain(Math.max(1, deadline - now()))
    } while (queue.length > 0 && now() < deadline)
    if (queue.length > 0) {
      dropped += queue.length
      queue.length = 0
    }
  }

  async function shutdown(deadlineMs: number): Promise<void> {
    if (closed) return
    closed = true
    if (timer) clearInterval(timer)
    await flush(deadlineMs).catch(() => undefined)
  }

  return {
    ids,
    logger: {
      debug: (event: string, attributes?: TelemetryAttributes) => enqueue('debug', event, undefined, attributes),
      info: (event: string, attributes?: TelemetryAttributes) => enqueue('info', event, undefined, attributes),
      warn: (event: string, attributes?: TelemetryAttributes) => enqueue('warn', event, undefined, attributes),
      error: (event: string, error?: unknown, attributes?: TelemetryAttributes) =>
        enqueue('error', event, error, attributes),
    },
    metrics,
    current: () => storage.getStore(),
    run: <T>(context: TelemetryContext, work: () => T): T => storage.run(context, work),
    childContext,
    contextFromHeaders,
    trace,
    flush,
    shutdown,
    stats: () => ({ queued: queue.length, dropped, exportFailures, seriesDropped }),
  }
}

export function normalizeHttpRoute(pathname: string): (typeof route)[number] {
  if (pathname === '/health/live') return 'health_live'
  if (pathname === '/health/ready') return 'health_ready'
  if (pathname === '/metrics' || pathname === '/internal/metrics' || pathname === '/api/metrics') return 'metrics'
  if (pathname.startsWith('/trpc')) return 'trpc'
  if (pathname.startsWith('/auth')) return 'auth'
  if (pathname.startsWith('/internal/operations')) return 'operations'
  if (pathname.startsWith('/api/matches')) return 'matches'
  if (pathname.startsWith('/api/overlay')) return 'overlay'
  return 'other'
}

export function statusClassOf(status: number): (typeof statusClass)[number] {
  const value = `${Math.max(1, Math.min(5, Math.floor(status / 100)))}xx`
  return statusClass.includes(value as never) ? (value as (typeof statusClass)[number]) : '5xx'
}

export function instrumentHttpHandler(
  telemetry: Telemetry,
  runtimeName: 'api' | 'operations-worker' | 'web' | 'discord',
  handler: (request: Request) => Response | Promise<Response>,
  options: { acceptIncoming?: (request: Request) => boolean } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const context = telemetry.contextFromHeaders(
      {
        'x-request-id': request.headers.get('x-request-id'),
        traceparent: request.headers.get('traceparent'),
      },
      { acceptIncoming: options.acceptIncoming?.(request) === true },
    )
    const started = performance.now()
    let pathname = '/'
    try {
      pathname = new URL(request.url).pathname
    } catch {
      pathname = '/'
    }
    const routeName = normalizeHttpRoute(pathname)
    return telemetry.run(context, () =>
      telemetry.trace('http.server', { runtime: runtimeName, method: request.method, route: routeName }, async () => {
        let response: Response
        try {
          response = await handler(request)
        } catch (error) {
          const durationMs = performance.now() - started
          const labels = { runtime: runtimeName, method: request.method, route: routeName, status_class: '5xx' }
          telemetry.metrics.add('http_server_requests_total', 1, labels)
          telemetry.metrics.observe('http_server_duration_ms', durationMs, labels)
          telemetry.logger.error('http.request.failed', error, {
            method: request.method,
            route: routeName,
            status: 500,
            durationMs,
          })
          throw error
        }
        const durationMs = performance.now() - started
        const labels = {
          runtime: runtimeName,
          method: request.method,
          route: routeName,
          status_class: statusClassOf(response.status),
        }
        telemetry.metrics.add('http_server_requests_total', 1, labels)
        telemetry.metrics.observe('http_server_duration_ms', durationMs, labels)
        telemetry.logger.info('http.request.completed', {
          method: request.method,
          route: routeName,
          status: response.status,
          durationMs,
        })
        const headers = new Headers(response.headers)
        headers.set('x-request-id', context.requestId)
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
      }),
    )
  }
}

export type TelemetryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function telemetryFetch(
  telemetry: Telemetry,
  domain: 'api' | 'discord' | 'steam' | 'turnstile' | 'r2' | 'brawlhalla-v0' | 'brawlhalla-v1',
  fetcher: TelemetryFetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { propagateContext?: boolean } = {},
): Promise<Response> {
  const context = telemetry.current()
  const headers = new Headers(init.headers)
  if (context && options.propagateContext) {
    headers.set('x-request-id', context.requestId)
    headers.set('traceparent', formatTraceparent(context))
  }
  const started = performance.now()
  try {
    const response = await fetcher(input, { ...init, headers })
    const outcome = response.ok ? 'succeeded' : response.status === 404 ? 'not_found' : 'failed'
    telemetry.metrics.add('source_calls_total', 1, { domain, outcome })
    telemetry.metrics.observe('source_duration_ms', performance.now() - started, { domain, outcome })
    return response
  } catch (error) {
    telemetry.metrics.add('source_calls_total', 1, { domain, outcome: 'failed' })
    telemetry.metrics.observe('source_duration_ms', performance.now() - started, { domain, outcome: 'failed' })
    telemetry.logger.error('source.call.failed', error, { domain })
    throw error
  }
}

export async function observeSourceCall<T>(
  telemetry: Telemetry,
  domain: 'api' | 'discord' | 'steam' | 'turnstile' | 'r2' | 'brawlhalla-v0' | 'brawlhalla-v1',
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now()
  try {
    const result = await telemetry.trace('source.call', { domain }, work)
    telemetry.metrics.add('source_calls_total', 1, { domain, outcome: 'succeeded' })
    telemetry.metrics.observe('source_duration_ms', performance.now() - started, { domain, outcome: 'succeeded' })
    return result
  } catch (error) {
    telemetry.metrics.add('source_calls_total', 1, { domain, outcome: 'failed' })
    telemetry.metrics.observe('source_duration_ms', performance.now() - started, { domain, outcome: 'failed' })
    telemetry.logger.error('source.call.failed', error, { domain })
    throw error
  }
}
