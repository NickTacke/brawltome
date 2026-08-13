import { describe, expect, test } from 'bun:test'
import { createTelemetry } from '@brawltome/telemetry'
import { createOperationsTelemetryObserver } from '../src/operations-worker-runtime'

const snapshot = {
  observedAt: '2025-01-01T00:00:00.000Z',
  oldestPending: [{ workClass: 'leaderboard' as const, ageMs: 42 }],
  deadLetters: [{ workClass: 'leaderboard' as const, kind: 'leaderboard-1v1' as const, count: 2 }],
  scheduleLateness: [{ kind: 'leaderboard-1v1' as const, latenessMs: 17 }],
}

describe('operations worker telemetry observer', () => {
  test('is non-blocking, timeout-bounded, and single-flight when inspection ignores cancellation', async () => {
    let calls = 0
    const never = new Promise<never>(() => {})
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const observer = createOperationsTelemetryObserver({
      operations: {
        inspectTelemetry: () => {
          calls++
          return never
        },
      } as never,
      telemetry,
      intervalMs: 1,
      timeoutMs: 5,
    })
    const started = performance.now()

    observer.trigger()
    observer.trigger()
    expect(performance.now() - started).toBeLessThan(5)
    await Bun.sleep(15)
    observer.trigger()

    expect(calls).toBe(1)
  })

  test('retains last-good measurements after a later failure', async () => {
    let now = 0
    let calls = 0
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const observer = createOperationsTelemetryObserver({
      operations: {
        inspectTelemetry: async () => {
          calls++
          if (calls === 1) return snapshot
          throw new Error('offline')
        },
      } as never,
      telemetry,
      intervalMs: 10,
      timeoutMs: 50,
      now: () => now,
    })

    observer.trigger()
    await Bun.sleep(0)
    now = 20
    observer.trigger()
    await Bun.sleep(0)

    const metrics = telemetry.metrics.snapshot()
    expect(metrics.find(({ name }) => name === 'operation_oldest_pending_age_ms')?.series[0]?.value).toBe(42)
    expect(metrics.find(({ name }) => name === 'operation_dead_letters')?.series[0]?.value).toBe(2)
    expect(metrics.find(({ name }) => name === 'schedule_lateness_ms')?.series[0]?.value).toBe(17)
  })
})
