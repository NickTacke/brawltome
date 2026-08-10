export type TelemetryContext = Readonly<{
  requestId: string
  traceId: string
  spanId: string
  parentSpanId?: string
  sampled: boolean
}>

export type TelemetryIds = {
  traceId(): string
  spanId(): string
  requestId(): string
}

const safeRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function parseTraceparent(
  value: string | null | undefined,
): { traceId: string; spanId: string; sampled: boolean } | null {
  if (!value) return null
  const match = traceparentPattern.exec(value.trim().toLowerCase())
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null
  return { traceId: match[1], spanId: match[2], sampled: (Number.parseInt(match[3], 16) & 1) === 1 }
}

export function formatTraceparent(context: TelemetryContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`
}

export function requestContextFromHeaders(
  headers: Readonly<Record<string, string | null | undefined>>,
  ids: TelemetryIds,
  options: { acceptIncoming?: boolean } = {},
): TelemetryContext {
  const incoming = options.acceptIncoming ? parseTraceparent(headers.traceparent) : null
  return {
    requestId:
      options.acceptIncoming && safeRequestId.test(headers['x-request-id'] ?? '')
        ? (headers['x-request-id'] as string)
        : ids.requestId(),
    traceId: incoming?.traceId ?? ids.traceId(),
    spanId: incoming?.spanId ?? ids.spanId(),
    sampled: incoming?.sampled ?? true,
  }
}

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}

export function createEdgeRequestContext(): TelemetryContext {
  return {
    requestId: crypto.randomUUID(),
    traceId: randomHex(16),
    spanId: randomHex(8),
    sampled: false,
  }
}
