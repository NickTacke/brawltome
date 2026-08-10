import { describe, expect, test } from 'bun:test'
import { createMetricsRegistry } from '../src/metrics'

describe('legacy metrics failure isolation', () => {
  test('never rejects product paths when Redis telemetry is unavailable', async () => {
    const reject = () => Promise.reject(new Error('offline'))
    const pipeline = { hincrby: () => pipeline, sadd: () => pipeline, exec: reject }
    const unavailable = {
      multi: () => pipeline,
      hgetall: reject,
      smembers: reject,
      set: reject,
      get: reject,
      hincrby: reject,
    }
    const metrics = createMetricsRegistry(unavailable as never)

    await expect(metrics.incrementQueue('queue', 'rejected_total')).resolves.toBeUndefined()
    await expect(metrics.setScalar('source:remaining', 2)).resolves.toBeUndefined()
    await expect(metrics.incrementCounter('counter')).resolves.toBeUndefined()
    await expect(metrics.snapshotQueue('queue')).resolves.toEqual({})
    await expect(metrics.snapshotAllQueues()).resolves.toEqual({})
    await expect(metrics.getScalar('source:remaining')).resolves.toBeNull()
    await expect(metrics.snapshotCounters()).resolves.toEqual({})
  })

  test('strictly bounds hanging Redis mutations and reads', async () => {
    const never = new Promise<never>(() => {})
    const pipeline = { hincrby: () => pipeline, sadd: () => pipeline, exec: () => never }
    const hanging = {
      multi: () => pipeline,
      hgetall: () => never,
      smembers: () => never,
      set: () => never,
      get: () => never,
      hincrby: () => never,
    }
    const metrics = createMetricsRegistry(hanging as never, { timeoutMs: 5 })
    const started = performance.now()

    await metrics.incrementQueue('queue', 'rejected_total')
    await metrics.setScalar('source:remaining', 2)
    await metrics.incrementCounter('counter')
    expect(await metrics.snapshotQueue('queue')).toEqual({})
    expect(await metrics.snapshotAllQueues()).toEqual({})
    expect(await metrics.getScalar('source:remaining')).toBeNull()
    expect(await metrics.snapshotCounters()).toEqual({})

    expect(performance.now() - started).toBeLessThan(250)
  })
})
