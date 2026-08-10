import { createJsonConsoleSink, createTelemetry } from '@brawltome/telemetry'

const globalTelemetry = globalThis as typeof globalThis & {
  __brawltomeWebTelemetry?: ReturnType<typeof createTelemetry>
}

export const webTelemetry =
  globalTelemetry.__brawltomeWebTelemetry ??
  createTelemetry({
    service: 'web',
    sink: createJsonConsoleSink(),
    capacity: 500,
    drainIntervalMs: 1_000,
    exportTimeoutMs: 250,
    sampleRate: 0.05,
  })

globalTelemetry.__brawltomeWebTelemetry = webTelemetry
