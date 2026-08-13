import { describe, expect, test } from 'bun:test'
import { createApiReadinessMonitor } from '../src/api-readiness'

describe('Discord API readiness monitor', () => {
  test('expires successful proofs and clears readiness when a periodic probe fails', async () => {
    let now = 1_000
    let succeeds = true
    let scheduledCheck: (() => Promise<boolean>) | undefined
    let stopped = false
    const monitor = createApiReadinessMonitor({
      verify: async () => succeeds,
      now: () => now,
      intervalMs: 100,
      maxAgeMs: 250,
      schedule: (check) => {
        scheduledCheck = check
        return () => {
          stopped = true
        }
      },
    })

    expect(monitor.isReady()).toBe(false)
    await monitor.check()
    expect(monitor.isReady()).toBe(true)

    now = 1_251
    expect(monitor.isReady()).toBe(false)

    succeeds = false
    await scheduledCheck?.()
    expect(monitor.isReady()).toBe(false)

    succeeds = true
    await scheduledCheck?.()
    expect(monitor.isReady()).toBe(true)

    monitor.stop()
    expect(stopped).toBe(true)
    expect(monitor.isReady()).toBe(false)
  })
})
