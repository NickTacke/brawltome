import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import Redis from 'ioredis'
import { RequestQueue } from '../src/request-queue'

describe('RequestQueue', () => {
  describe('burst spacing', () => {
    it('grants first request immediately', async () => {
      const queue = new RequestQueue({ minSpacingMs: 100, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      const waited = await queue.acquire('on-demand')
      expect(waited).toBeLessThan(10)
    })

    it('enforces minimum spacing between requests', async () => {
      const queue = new RequestQueue({ minSpacingMs: 50, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      await queue.acquire('on-demand')
      const start = Date.now()
      await queue.acquire('on-demand')
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(40) // allow small timing tolerance
    })

    it('serializes concurrent callers', async () => {
      const queue = new RequestQueue({ minSpacingMs: 50, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      const start = Date.now()
      // Fire 3 concurrent acquire() calls
      const results = await Promise.all([
        queue.acquire('on-demand'),
        queue.acquire('on-demand'),
        queue.acquire('on-demand'),
      ])
      const totalElapsed = Date.now() - start
      // 3 requests with 50ms spacing = at least 100ms total
      expect(totalElapsed).toBeGreaterThanOrEqual(90)
      // First should be near-instant, others should have waited
      expect(results[0]).toBeLessThan(10)
      expect(results[1]).toBeGreaterThanOrEqual(40)
      expect(results[2]).toBeGreaterThanOrEqual(90)
    })
  })

  describe('sustained window', () => {
    it('reports remaining capacity', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 5, sustainedWindowMs: 900_000 })
      expect(queue.remainingOnDemand).toBe(5)
      await queue.acquire('on-demand')
      expect(queue.remainingOnDemand).toBe(4)
    })

    it('blocks when sustained limit reached', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 2, sustainedWindowMs: 100 })
      await queue.acquire('on-demand')
      await queue.acquire('on-demand')
      expect(queue.remainingOnDemand).toBe(0)
      const start = Date.now()
      await queue.acquire('on-demand')
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(80)
    })

    it('prunes old timestamps from window', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 3, sustainedWindowMs: 50 })
      await queue.acquire('on-demand')
      await queue.acquire('on-demand')
      expect(queue.remainingOnDemand).toBe(1)
      await Bun.sleep(60)
      expect(queue.remainingOnDemand).toBe(3)
    })
  })

  describe('pause', () => {
    it('blocks acquire during pause', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      queue.pause(100)
      expect(queue.isPaused).toBe(true)
      const start = Date.now()
      await queue.acquire('on-demand')
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(80)
    })

    it('resumes after pause expires', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      queue.pause(50)
      await Bun.sleep(60)
      expect(queue.isPaused).toBe(false)
      const waited = await queue.acquire('on-demand')
      expect(waited).toBeLessThan(10)
    })
  })
})

describe('RequestQueue headroom', () => {
  it('background cannot use reserved headroom', async () => {
    const q = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      onDemandHeadroom: 3,
    })

    // Background effective limit = 10 - 3 = 7
    for (let i = 0; i < 7; i++) {
      await q.acquire('background')
    }
    // 8th background acquire should block; race it against a short sleep
    const blocked = await Promise.race([
      q.acquire('background').then(() => 'acquired'),
      Bun.sleep(100).then(() => 'blocked'),
    ])
    expect(blocked).toBe('blocked')
  })

  it('on-demand can use the reserved headroom', async () => {
    const q = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      onDemandHeadroom: 3,
    })

    for (let i = 0; i < 7; i++) {
      await q.acquire('background')
    }
    // On-demand should still get through for the next 3 slots
    for (let i = 0; i < 3; i++) {
      await q.acquire('on-demand')
    }
    expect(q.remainingOnDemand).toBe(0)
  })

  it('remainingOnDemand vs remainingBackground reflect headroom', () => {
    const q = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      onDemandHeadroom: 3,
    })
    expect(q.remainingOnDemand).toBe(10)
    expect(q.remainingBackground).toBe(7)
  })

  it('defaults to headroom 0 when option omitted (background sees full limit)', () => {
    const q = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 10, sustainedWindowMs: 60_000 })
    expect(q.remainingBackground).toBe(10)
    expect(q.remainingOnDemand).toBe(10)
  })
})

describe('RequestQueue persistence', () => {
  let redis: Redis
  const keyPrefix = `test-bhapi-${Date.now()}`

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  })

  afterAll(async () => {
    const keys = await redis.keys(`${keyPrefix}:*`)
    if (keys.length > 0) await redis.del(...keys)
    await redis.quit()
  })

  it('restores timestamps across restarts', async () => {
    const first = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      persistence: { redis, keyPrefix },
    })

    for (let i = 0; i < 5; i++) await first.acquire('on-demand')
    expect(first.remainingOnDemand).toBe(5)

    // Give fire-and-forget writes a moment
    await Bun.sleep(50)

    const second = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      persistence: { redis, keyPrefix },
    })
    await second.init()

    expect(second.remainingOnDemand).toBe(5)
  })

  it('restores pausedUntil across restarts', async () => {
    const prefix = `${keyPrefix}-pause`
    const first = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      persistence: { redis, keyPrefix: prefix },
    })
    first.pause(30_000)
    await Bun.sleep(50)

    const second = new RequestQueue({
      minSpacingMs: 0,
      sustainedLimit: 10,
      sustainedWindowMs: 60_000,
      persistence: { redis, keyPrefix: prefix },
    })
    await second.init()

    expect(second.isPaused).toBe(true)
    expect(second.pausedUntilMs).toBeGreaterThan(Date.now())
  })
})
