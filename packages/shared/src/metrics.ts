import type { Redis } from 'ioredis'

export type QueueMetricField =
  | 'rejected_total'
  | 'rate_limit_retries_total'
  | 'priority_drained_total'
  | 'regular_drained_total'
  | 'dedup_skipped_total'
  | 'janitor_throttled_total'

export type QueueMetricSnapshot = Partial<Record<QueueMetricField, number>>

export interface MetricsRegistry {
  incrementQueue(name: string, field: QueueMetricField): Promise<void>
  snapshotQueue(name: string): Promise<QueueMetricSnapshot>
  snapshotAllQueues(): Promise<Record<string, QueueMetricSnapshot>>
  setScalar(key: string, value: number): Promise<void>
  getScalar(key: string): Promise<number | null>
  incrementCounter(key: string, by?: number): Promise<void>
  snapshotCounters(): Promise<Record<string, number>>
}

export function createMetricsRegistry(redis: Redis): MetricsRegistry {
  async function incrementQueue(name: string, field: QueueMetricField): Promise<void> {
    const pipeline = redis.multi()
    pipeline.hincrby(`metrics:queue:${name}`, field, 1)
    pipeline.sadd('metrics:queues:known', name)
    await pipeline.exec()
  }

  async function snapshotQueue(name: string): Promise<QueueMetricSnapshot> {
    const data = await redis.hgetall(`metrics:queue:${name}`)
    const out: QueueMetricSnapshot = {}
    for (const [k, v] of Object.entries(data)) {
      out[k as QueueMetricField] = Number(v)
    }
    return out
  }

  async function snapshotAllQueues(): Promise<Record<string, QueueMetricSnapshot>> {
    const names = await redis.smembers('metrics:queues:known')
    const snaps = await Promise.all(names.map(async (n) => [n, await snapshotQueue(n)] as const))
    return Object.fromEntries(snaps)
  }

  async function setScalar(key: string, value: number): Promise<void> {
    await redis.set(`metrics:${key}`, String(value))
  }

  async function getScalar(key: string): Promise<number | null> {
    const v = await redis.get(`metrics:${key}`)
    return v === null ? null : Number(v)
  }

  async function incrementCounter(key: string, by = 1): Promise<void> {
    await redis.hincrby('metrics:counters', key, by)
  }

  async function snapshotCounters(): Promise<Record<string, number>> {
    const data = await redis.hgetall('metrics:counters')
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(data)) out[k] = Number(v)
    return out
  }

  return {
    incrementQueue,
    snapshotQueue,
    snapshotAllQueues,
    setScalar,
    getScalar,
    incrementCounter,
    snapshotCounters,
  }
}
