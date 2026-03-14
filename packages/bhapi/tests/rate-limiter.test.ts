import { describe, expect, it } from 'bun:test'
import { TokenBucket } from '../src/rate-limiter'

describe('TokenBucket', () => {
  it('allows requests within capacity', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, intervalMs: 1000 })
    for (let i = 0; i < 5; i++) {
      const waited = await bucket.acquire()
      expect(waited).toBe(0)
    }
  })

  it('blocks when tokens exhausted', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 2, intervalMs: 100 })
    await bucket.acquire()
    await bucket.acquire()
    const start = Date.now()
    await bucket.acquire()
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(80)
  })

  it('reports remaining tokens', async () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 10, intervalMs: 1000 })
    expect(bucket.remaining).toBe(10)
    await bucket.acquire()
    expect(bucket.remaining).toBe(9)
  })

  it('refills tokens after interval', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 2, intervalMs: 50 })
    await bucket.acquire()
    await bucket.acquire()
    expect(bucket.remaining).toBe(0)
    await Bun.sleep(60)
    expect(bucket.remaining).toBe(2)
  })
})
