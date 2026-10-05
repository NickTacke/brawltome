import { describe, expect, test } from 'bun:test'
import { createDiscoveryReconciliationBackoff } from '../src/discovery-reconciliation-backoff'

type Status = 'pending' | 'leased' | 'succeeded' | 'dead_letter' | null

function harness() {
  const clock = { now: 0 }
  const statuses = new Map<string, Status>()
  const lookups: string[] = []
  const backoff = createDiscoveryReconciliationBackoff({
    baseMs: 5 * 60_000,
    maxMs: 60 * 60_000,
    now: () => clock.now,
    operationStatus: async (operationId) => {
      lookups.push(operationId)
      return statuses.get(operationId) ?? null
    },
  })
  return { clock, statuses, lookups, backoff }
}

describe('discovery reconciliation backoff', () => {
  test('stops re-enqueueing after a dead-lettered reconciliation and grows the cooldown on repeated failure', async () => {
    const { clock, statuses, backoff } = harness()
    expect(await backoff.shouldEnqueue('player')).toBe(true)
    backoff.recordEnqueued('player', 'run-1')
    statuses.set('run-1', 'leased')
    expect(await backoff.shouldEnqueue('player')).toBe(true)

    statuses.set('run-1', 'dead_letter')
    clock.now = 1_000
    expect(await backoff.shouldEnqueue('player')).toBe(false)
    clock.now = 1_000 + 5 * 60_000 - 1
    expect(await backoff.shouldEnqueue('player')).toBe(false)
    clock.now = 1_000 + 5 * 60_000
    expect(await backoff.shouldEnqueue('player')).toBe(true)

    backoff.recordEnqueued('player', 'run-2')
    statuses.set('run-2', 'dead_letter')
    const secondFailureAt = clock.now
    expect(await backoff.shouldEnqueue('player')).toBe(false)
    clock.now = secondFailureAt + 10 * 60_000 - 1
    expect(await backoff.shouldEnqueue('player')).toBe(false)
    clock.now = secondFailureAt + 10 * 60_000
    expect(await backoff.shouldEnqueue('player')).toBe(true)
  })

  test('caps the cooldown, resets it after success, and tracks owners independently', async () => {
    const { clock, statuses, lookups, backoff } = harness()
    for (let failure = 1; failure <= 6; failure++) {
      expect(await backoff.shouldEnqueue('clan')).toBe(true)
      backoff.recordEnqueued('clan', `clan-${failure}`)
      statuses.set(`clan-${failure}`, 'dead_letter')
      expect(await backoff.shouldEnqueue('clan')).toBe(false)
      clock.now += Math.min(5 * 60_000 * 2 ** (failure - 1), 60 * 60_000)
    }
    expect(await backoff.shouldEnqueue('player')).toBe(true)

    expect(await backoff.shouldEnqueue('clan')).toBe(true)
    backoff.recordEnqueued('clan', 'clan-ok')
    statuses.set('clan-ok', 'succeeded')
    expect(await backoff.shouldEnqueue('clan')).toBe(true)
    backoff.recordEnqueued('clan', 'clan-after-success')
    statuses.set('clan-after-success', 'dead_letter')
    const failedAt = clock.now
    expect(await backoff.shouldEnqueue('clan')).toBe(false)
    clock.now = failedAt + 5 * 60_000
    const before = lookups.length
    expect(await backoff.shouldEnqueue('clan')).toBe(true)
    expect(lookups.length).toBe(before)
  })
})
