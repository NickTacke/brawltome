import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createQueue, dedupKey, tryDedup } from '@brawltome/shared'
import Redis from 'ioredis'

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

describe('Queue maxDepth', () => {
  it('rejects enqueue when depth >= maxDepth', async () => {
    const queue = createQueue<{ value: number }>(
      redis,
      'test-maxdepth',
      async () => {},
      { concurrency: 0, maxDepth: 3 },
    )

    const a = await queue.enqueue({ value: 1 })
    const b = await queue.enqueue({ value: 2 })
    const c = await queue.enqueue({ value: 3 })
    const d = await queue.enqueue({ value: 4 })

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(c).toBe(true)
    expect(d).toBe(false)
  })
})

describe('Queue dedup', () => {
  it('rejects duplicate enqueue while in-flight', async () => {
    const queue = createQueue<{ brawlhallaId: number }>(
      redis,
      'test-dedup-queue',
      async () => {},
      { concurrency: 0, dedupKey: (d) => String(d.brawlhallaId) },
    )

    const first = await queue.enqueue({ brawlhallaId: 123 })
    const second = await queue.enqueue({ brawlhallaId: 123 })
    const other = await queue.enqueue({ brawlhallaId: 456 })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(other).toBe(true)

    // Cleanup
    await redis.del('queue:test-dedup-queue:dedup:123')
    await redis.del('queue:test-dedup-queue:dedup:456')
  })

  it('releases dedup key after successful processing', async () => {
    let runs = 0
    const queue = createQueue<{ brawlhallaId: number }>(
      redis,
      'test-dedup-release',
      async () => {
        runs++
      },
      { concurrency: 1, dedupKey: (d) => String(d.brawlhallaId) },
    )

    await queue.enqueue({ brawlhallaId: 999 })
    queue.start()
    await Bun.sleep(300)

    const afterFirst = await queue.enqueue({ brawlhallaId: 999 })
    await Bun.sleep(300)
    queue.stop()

    expect(runs).toBe(2)
    expect(afterFirst).toBe(true)
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
