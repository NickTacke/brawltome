import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createMetricsRegistry } from '@brawltome/shared'
import Redis from 'ioredis'

let redis: Redis

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  const keys = await redis.keys('metrics:*')
  if (keys.length > 0) await redis.del(...keys)
})

afterAll(async () => {
  const keys = await redis.keys('metrics:*')
  if (keys.length > 0) await redis.del(...keys)
  await redis.quit()
})

describe('MetricsRegistry', () => {
  it('increments and reads queue counters', async () => {
    const metrics = createMetricsRegistry(redis)
    await metrics.incrementQueue('test-queue', 'rejected_total')
    await metrics.incrementQueue('test-queue', 'rejected_total')
    await metrics.incrementQueue('test-queue', 'priority_drained_total')

    const snap = await metrics.snapshotQueue('test-queue')
    expect(snap.rejected_total).toBe(2)
    expect(snap.priority_drained_total).toBe(1)
  })

  it('sets and reads scalar metrics', async () => {
    const metrics = createMetricsRegistry(redis)
    await metrics.setScalar('bhapi:tokens_on_demand_remaining', 42)

    const value = await metrics.getScalar('bhapi:tokens_on_demand_remaining')
    expect(value).toBe(42)
  })

  it('snapshotAllQueues returns map across known queues', async () => {
    const metrics = createMetricsRegistry(redis)
    await metrics.incrementQueue('queue-a', 'rejected_total')
    await metrics.incrementQueue('queue-b', 'rate_limit_retries_total')

    const snap = await metrics.snapshotAllQueues()
    expect(snap['queue-a']?.rejected_total).toBe(1)
    expect(snap['queue-b']?.rate_limit_retries_total).toBe(1)
  })

  it('incrementCounter and snapshotCounters track free-form keys', async () => {
    const metrics = createMetricsRegistry(redis)
    await metrics.incrementCounter('matchmaking_ingest_ok')
    await metrics.incrementCounter('matchmaking_ingest_ok')
    await metrics.incrementCounter('matchmaking_ingest_rejected_tampered')

    const snap = await metrics.snapshotCounters()
    expect(snap.matchmaking_ingest_ok).toBe(2)
    expect(snap.matchmaking_ingest_rejected_tampered).toBe(1)
  })
})
