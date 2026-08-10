import { createNodeRuntimeTelemetry } from '@brawltome/telemetry/node'

function traceSampleRate(value: string | undefined): number {
  const parsed = value === undefined ? 0.1 : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1
}

export const discordTelemetry = createNodeRuntimeTelemetry({
  service: 'discord',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  authorization: process.env.OTEL_EXPORTER_OTLP_AUTHORIZATION,
  capacity: 500,
  drainIntervalMs: 1_000,
  exportTimeoutMs: 250,
  sampleRate: traceSampleRate(process.env.TELEMETRY_TRACE_SAMPLE_RATE),
})
