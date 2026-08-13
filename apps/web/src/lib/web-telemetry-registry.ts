import { createFanoutSink, createJsonConsoleSink, createOtlpHttpSink, createTelemetry } from '@brawltome/telemetry'

function traceSampleRate(value: string | undefined): number {
  const parsed = value === undefined ? 0.05 : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.05
}

export const webTraceSampleRate = traceSampleRate(process.env.TELEMETRY_TRACE_SAMPLE_RATE)
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
export const webOtlpHeaders = process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION?.trim()
  ? { authorization: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION.trim() }
  : undefined
const consoleSink = createJsonConsoleSink()
let sink = consoleSink
if (endpoint) {
  try {
    sink = createFanoutSink([consoleSink, createOtlpHttpSink({ endpoint, headers: webOtlpHeaders })])
  } catch {
    sink = consoleSink
  }
}

const globalTelemetry = globalThis as typeof globalThis & {
  __brawltomeWebTelemetry?: ReturnType<typeof createTelemetry>
}

export const webTelemetry =
  globalTelemetry.__brawltomeWebTelemetry ??
  createTelemetry({
    service: 'web',
    sink,
    capacity: 500,
    drainIntervalMs: 1_000,
    exportTimeoutMs: 250,
    sampleRate: webTraceSampleRate,
  })

globalTelemetry.__brawltomeWebTelemetry = webTelemetry
