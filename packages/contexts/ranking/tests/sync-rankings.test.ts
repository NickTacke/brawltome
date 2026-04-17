import { describe, expect, it, mock } from 'bun:test'
import type { MetricsRegistry } from '@brawltome/shared'

// Helper under test (mirrors the implementation in sync-rankings.ts)
async function safeEnqueue<T>(
  queue: { enqueue: (d: T, priority?: boolean) => Promise<boolean> },
  data: T,
  metrics: MetricsRegistry | undefined,
  queueName: string,
): Promise<boolean> {
  const ok = await queue.enqueue(data)
  if (!ok && metrics) await metrics.incrementQueue(queueName, 'janitor_throttled_total')
  return ok
}

describe('janitor enqueue rejection', () => {
  it('increments janitor_throttled_total when enqueue returns false', async () => {
    const incrementQueue = mock(() => Promise.resolve())
    const metrics: MetricsRegistry = {
      incrementQueue,
      snapshotQueue: async () => ({}),
      snapshotAllQueues: async () => ({}),
      setScalar: async () => {},
      getScalar: async () => null,
    }

    const queue = { enqueue: async () => false }

    const result = await safeEnqueue(queue, { brawlhallaId: 1 }, metrics, 'refresh-ranked')

    expect(result).toBe(false)
    expect(incrementQueue).toHaveBeenCalledWith('refresh-ranked', 'janitor_throttled_total')
  })

  it('does not increment metric when enqueue succeeds', async () => {
    const incrementQueue = mock(() => Promise.resolve())
    const metrics: MetricsRegistry = {
      incrementQueue,
      snapshotQueue: async () => ({}),
      snapshotAllQueues: async () => ({}),
      setScalar: async () => {},
      getScalar: async () => null,
    }

    const queue = { enqueue: async () => true }

    const result = await safeEnqueue(queue, { brawlhallaId: 1 }, metrics, 'refresh-ranked')

    expect(result).toBe(true)
    expect(incrementQueue).not.toHaveBeenCalled()
  })

  it('handles missing metrics registry', async () => {
    const queue = { enqueue: async () => false }
    const result = await safeEnqueue(queue, { brawlhallaId: 1 }, undefined, 'refresh-ranked')
    expect(result).toBe(false)
  })
})
