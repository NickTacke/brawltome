import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { startDiscordMetricsServer } from '../src/metrics-server'

describe('Discord metrics and health listener', () => {
  test('separates process liveness from Discord readiness and protects metrics', async () => {
    const telemetry = createTelemetry({ service: 'discord', drainIntervalMs: 0 })
    let ready = false
    let handler: ((request: Request) => Response | Promise<Response>) | undefined
    const server = startDiscordMetricsServer({
      telemetry,
      port: 3002,
      secret: 'internal-secret',
      readiness: () => ready,
      serve: ((options: { fetch: typeof handler }) => {
        handler = options.fetch
        return { stop: async () => {} }
      }) as never,
    })
    expect(server).toBeDefined()
    expect((await handler?.(new Request('http://localhost/health/live')))?.status).toBe(200)
    expect((await handler?.(new Request('http://localhost/health/ready')))?.status).toBe(503)
    ready = true
    expect((await handler?.(new Request('http://localhost/health/ready')))?.status).toBe(200)
    expect((await handler?.(new Request('http://localhost/metrics')))?.status).toBe(401)
    expect(
      (
        await handler?.(
          new Request('http://localhost/metrics', { headers: { 'x-internal-secret': 'internal-secret' } }),
        )
      )?.status,
    ).toBe(401)
    expect(
      (
        await handler?.(
          new Request('http://localhost/metrics', { headers: { 'x-metrics-secret': 'internal-secret' } }),
        )
      )?.status,
    ).toBe(200)
  })

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
