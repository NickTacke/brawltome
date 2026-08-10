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

export function createMetricsRegistry(redis: Redis, options: { timeoutMs?: number } = {}): MetricsRegistry {
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 50, 1_000))
  let lastFailureWarningAt = 0
  function reportFailure(error: unknown): void {
    const now = Date.now()
    if (now - lastFailureWarningAt < 60_000) return
    lastFailureWarningAt = now
    console.warn('[legacy-metrics] Redis telemetry unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
  }

  async function withinTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis metrics timeout')), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function incrementQueue(name: string, field: QueueMetricField): Promise<void> {
    try {
      const pipeline = redis.multi()
      pipeline.hincrby(`metrics:queue:${name}`, field, 1)
      pipeline.sadd('metrics:queues:known', name)
      await withinTimeout(pipeline.exec())
    } catch (error) {
      reportFailure(error)
    }
  }

  async function snapshotQueue(name: string): Promise<QueueMetricSnapshot> {
    try {
      const data = await withinTimeout(redis.hgetall(`metrics:queue:${name}`))
      const out: QueueMetricSnapshot = {}
      for (const [key, value] of Object.entries(data)) out[key as QueueMetricField] = Number(value)
      return out
    } catch (error) {
      reportFailure(error)
      return {}
    }
  }

  async function snapshotAllQueues(): Promise<Record<string, QueueMetricSnapshot>> {
    try {
      const names = await withinTimeout(redis.smembers('metrics:queues:known'))
      const snaps = await Promise.all(names.map(async (name) => [name, await snapshotQueue(name)] as const))
      return Object.fromEntries(snaps)
    } catch (error) {
      reportFailure(error)
      return {}
    }
  }

  async function setScalar(key: string, value: number): Promise<void> {
    try {
      await withinTimeout(redis.set(`metrics:${key}`, String(value)))
    } catch (error) {
      reportFailure(error)
    }
  }

  async function getScalar(key: string): Promise<number | null> {
    try {
      const value = await withinTimeout(redis.get(`metrics:${key}`))
      return value === null ? null : Number(value)
    } catch (error) {
      reportFailure(error)
      return null
    }
  }

  async function incrementCounter(key: string, by = 1): Promise<void> {
    try {
      await withinTimeout(redis.hincrby('metrics:counters', key, by))
    } catch (error) {
      reportFailure(error)
    }
  }

  async function snapshotCounters(): Promise<Record<string, number>> {
    try {
      const data = await withinTimeout(redis.hgetall('metrics:counters'))
      const out: Record<string, number> = {}
      for (const [key, value] of Object.entries(data)) out[key] = Number(value)
      return out
    } catch (error) {
      reportFailure(error)
      return {}
    }
  }

  return { incrementQueue, snapshotQueue, snapshotAllQueues, setScalar, getScalar, incrementCounter, snapshotCounters }
}
