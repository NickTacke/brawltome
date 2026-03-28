import { describe, expect, it } from 'bun:test'
import { RequestQueue } from '../src/request-queue'

describe('RequestQueue', () => {
  describe('burst spacing', () => {
    it('grants first request immediately', async () => {
      const queue = new RequestQueue({ minSpacingMs: 100, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      const waited = await queue.acquire()
      expect(waited).toBeLessThan(10)
    })

    it('enforces minimum spacing between requests', async () => {
      const queue = new RequestQueue({ minSpacingMs: 50, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      await queue.acquire()
      const start = Date.now()
      await queue.acquire()
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(40) // allow small timing tolerance
    })

    it('serializes concurrent callers', async () => {
      const queue = new RequestQueue({ minSpacingMs: 50, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      const start = Date.now()
      // Fire 3 concurrent acquire() calls
      const results = await Promise.all([queue.acquire(), queue.acquire(), queue.acquire()])
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
      expect(queue.remaining).toBe(5)
      await queue.acquire()
      expect(queue.remaining).toBe(4)
    })

    it('blocks when sustained limit reached', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 2, sustainedWindowMs: 100 })
      await queue.acquire()
      await queue.acquire()
      expect(queue.remaining).toBe(0)
      const start = Date.now()
      await queue.acquire()
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(80)
    })

    it('prunes old timestamps from window', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 3, sustainedWindowMs: 50 })
      await queue.acquire()
      await queue.acquire()
      expect(queue.remaining).toBe(1)
      await Bun.sleep(60)
      expect(queue.remaining).toBe(3)
    })
  })

  describe('pause', () => {
    it('blocks acquire during pause', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      queue.pause(100)
      expect(queue.isPaused).toBe(true)
      const start = Date.now()
      await queue.acquire()
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(80)
    })

    it('resumes after pause expires', async () => {
      const queue = new RequestQueue({ minSpacingMs: 0, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      queue.pause(50)
      await Bun.sleep(60)
      expect(queue.isPaused).toBe(false)
      const waited = await queue.acquire()
      expect(waited).toBe(0)
    })
  })
})
