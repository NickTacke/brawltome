import { createJsonConsoleSink, createTelemetry } from '@brawltome/telemetry'

export const discordTelemetry = createTelemetry({
  service: 'discord',
  sink: createJsonConsoleSink(),
  capacity: 500,
  drainIntervalMs: 1_000,
  exportTimeoutMs: 250,
  sampleRate: 0.1,
})
