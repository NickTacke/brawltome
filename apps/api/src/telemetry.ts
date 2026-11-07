import { parseBoundedInteger } from '@brawltome/foundation'
import { createNodeRuntimeTelemetry } from '@brawltome/telemetry/node'

// telemetry must never stop the process, so a bad setting falls back to the default instead of throwing
function telemetrySetting(text: string | undefined, name: string, fallback: number, maximum: number): number {
  try {
    return parseBoundedInteger(text, { name, fallback, minimum: 1, maximum })
  } catch {
    return fallback
  }
}

function sampleRate(value: string | undefined): number {
  const parsed = value === undefined ? 0.1 : Number(value)

  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1
}

export function createRuntimeTelemetry(service: 'api' | 'operations-worker') {
  return createNodeRuntimeTelemetry({
    service,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    authorization: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION,
    capacity: telemetrySetting(process.env.TELEMETRY_BUFFER_CAPACITY, 'TELEMETRY_BUFFER_CAPACITY', 1_000, 10_000),
    drainIntervalMs: telemetrySetting(
      process.env.TELEMETRY_DRAIN_INTERVAL_MS,
      'TELEMETRY_DRAIN_INTERVAL_MS',
      1_000,
      60_000,
    ),
    exportTimeoutMs: telemetrySetting(
      process.env.TELEMETRY_EXPORT_TIMEOUT_MS,
      'TELEMETRY_EXPORT_TIMEOUT_MS',
      250,
      5_000,
    ),
    sampleRate: sampleRate(process.env.TELEMETRY_TRACE_SAMPLE_RATE),
  })
}
