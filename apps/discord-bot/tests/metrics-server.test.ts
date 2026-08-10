import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { startDiscordMetricsServer } from '../src/metrics-server'

describe('Discord metrics listener', () => {
  test('fails open when the listener cannot bind', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'discord', sink, drainIntervalMs: 0 })

    const server = startDiscordMetricsServer({
      telemetry,
      port: 3002,
      secret: 'secret',
      serve: (() => {
        throw new Error('address in use')
      }) as never,
    })
    await telemetry.flush(50)

    expect(server).toBeUndefined()
    expect(sink.records[0]).toMatchObject({
      event: 'discord.metrics.startup_failed',
      error: { name: 'Error', message: 'Operation failed' },
    })
  })
})
