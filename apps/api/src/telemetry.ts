import { createJsonConsoleSink, createTelemetry } from '@brawltome/telemetry'

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

function sampleRate(value: string | undefined): number {
  const parsed = value === undefined ? 0.1 : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1
}

export function createRuntimeTelemetry(service: 'api' | 'operations-worker') {
  return createTelemetry({
    service,
    sink: createJsonConsoleSink(),
    capacity: boundedInteger(process.env.TELEMETRY_BUFFER_CAPACITY, 1_000, 10_000),
    drainIntervalMs: boundedInteger(process.env.TELEMETRY_DRAIN_INTERVAL_MS, 1_000, 60_000),
    exportTimeoutMs: boundedInteger(process.env.TELEMETRY_EXPORT_TIMEOUT_MS, 250, 5_000),
    sampleRate: sampleRate(process.env.TELEMETRY_TRACE_SAMPLE_RATE),
  })
}
