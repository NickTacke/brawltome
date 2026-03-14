import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import Redis from 'ioredis'
import { dedupKey, tryDedup } from '../src/queue/dedup'
import { createQueue } from '../src/queue/queue'

let redis: Redis

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
})

afterAll(async () => {
  // Clean up test keys
  const keys = await redis.keys('queue:test-*')
  if (keys.length > 0) await redis.del(...keys)
  const dedupKeys = await redis.keys('dedup:test-*')
  if (dedupKeys.length > 0) await redis.del(...dedupKeys)
  await redis.quit()
})

describe('Queue', () => {
  it('enqueues and processes a job', async () => {
    const results: number[] = []

    const queue = createQueue<{ value: number }>(
      redis,
      'test-basic',
      async (data) => {
        results.push(data.value)
      },
      { concurrency: 1 },
    )

    await queue.enqueue({ value: 42 })
    queue.start()
    await Bun.sleep(500)
    queue.stop()

    expect(results).toEqual([42])
  })

  it('retries failed jobs', async () => {
    let attempts = 0

    const queue = createQueue<{ value: number }>(
      redis,
      'test-retry',
      async () => {
        attempts++
        if (attempts < 3) throw new Error('fail')
      },
      { concurrency: 1, retries: 3, backoffMs: 50 },
    )

    await queue.enqueue({ value: 1 })
    queue.start()
    await Bun.sleep(1000)
    queue.stop()

    expect(attempts).toBe(3)
  })

  it('sends to DLQ after exhausting retries', async () => {
    const queue = createQueue<{ value: number }>(
      redis,
      'test-dlq',
      async () => {
        throw new Error('always fails')
      },
      { concurrency: 1, retries: 2, backoffMs: 50 },
    )

    await queue.enqueue({ value: 1 })
    queue.start()
    await Bun.sleep(1000)
    queue.stop()

    const dlqLen = await redis.xlen('queue:dlq')
    expect(dlqLen).toBeGreaterThanOrEqual(1)

    // Clean up DLQ
    await redis.del('queue:dlq')
  })
})

describe('Dedup', () => {
  it('allows first call and blocks duplicate', async () => {
    const key = dedupKey('test-dedup', 123)
    const first = await tryDedup(redis, key, 5)
    const second = await tryDedup(redis, key, 5)

    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('allows again after TTL expires', async () => {
    const key = dedupKey('test-dedup-ttl', 456)
    await tryDedup(redis, key, 1)
    await Bun.sleep(1100)
    const result = await tryDedup(redis, key, 1)

    expect(result).toBe(true)
  })
})
