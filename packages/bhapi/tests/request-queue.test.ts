import { describe, expect, it } from 'bun:test'
import { RequestQueue } from '../src/request-queue'

describe('RequestQueue', () => {
  describe('burst spacing', () => {
    it('grants first request immediately', async () => {
      const queue = new RequestQueue({ minSpacingMs: 100, sustainedLimit: 150, sustainedWindowMs: 900_000 })
      const waited = await queue.acquire()
      expect(waited).toBe(0)
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
      // First should be instant, others should have waited
      expect(results[0]).toBe(0)
      expect(results[1]).toBeGreaterThanOrEqual(40)
      expect(results[2]).toBeGreaterThanOrEqual(90)
    })
  })
})
