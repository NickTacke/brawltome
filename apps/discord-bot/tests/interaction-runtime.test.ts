import { describe, expect, test } from 'bun:test'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createInteractionRuntime } from '../src/interaction-runtime'

describe('Discord interaction telemetry runtime', () => {
  test('correlates interactions, isolates exporter failure, and drains within bounds', async () => {
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'discord', sink, drainIntervalMs: 0 })
    const runtime = createInteractionRuntime(telemetry)
    let finish: (() => void) | undefined
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })

    expect(runtime.run({ id: 'interaction-42', kind: 'command', command: 'player' }, () => work)).toBe(true)
    expect(runtime.activeCount).toBe(1)
    const draining = runtime.drain(100)
    expect(runtime.accepting).toBe(false)
    expect(runtime.run({ id: 'interaction-43', kind: 'command', command: 'player' }, async () => {})).toBe(false)
    const rejected = telemetry.metrics
      .snapshot()
      .find((metric) => metric.name === 'discord_interactions_total')
      ?.series.find((series) => series.labels.outcome === 'rejected')
    expect(rejected?.value).toBe(1)
    finish?.()
    expect(await draining).toBe(true)
    await telemetry.flush(50)
    expect(sink.records.some((record) => record.requestId === 'interaction-42')).toBe(true)
  })

  test('stops admission synchronously before draining active interactions', () => {
    const telemetry = createTelemetry({ service: 'discord', drainIntervalMs: 0 })
    const runtime = createInteractionRuntime(telemetry)
    runtime.stopAccepting()
    expect(runtime.accepting).toBe(false)
    expect(runtime.run({ id: 'interaction-45', kind: 'command', command: 'status' }, async () => {})).toBe(false)
    expect(runtime.activeCount).toBe(0)
  })

  test('returns after the drain deadline when an interaction is still active', async () => {
    const telemetry = createTelemetry({
      service: 'discord',
      sink: {
        export: async () => {
          throw new Error('offline')
        },
      },
      drainIntervalMs: 0,
    })
    const runtime = createInteractionRuntime(telemetry)
    runtime.run({ id: 'interaction-44', kind: 'button', command: 'component' }, () => new Promise(() => {}))
    expect(await runtime.drain(1)).toBe(false)
    await expect(telemetry.shutdown(1)).resolves.toBeUndefined()
  })
})
