import { describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'
import { RATE_LIMITS, checkRateLimit } from '../../apps/api/src/services/rate-limit'

// Minimal Redis mock
function createRedisMock(incrResult = 1) {
  return {
    incr: mock(() => Promise.resolve(incrResult)),
    expire: mock(() => Promise.resolve(1)),
    ttl: mock(() => Promise.resolve(-1)),
  }
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const redis = createRedisMock(1)
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(1)
  })

  it('sets TTL on first request (ttl === -1)', async () => {
    const redis = createRedisMock(1)
    redis.ttl = mock(() => Promise.resolve(-1))
    await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(redis.expire).toHaveBeenCalledWith('ratelimit:discovery:1.2.3.4', RATE_LIMITS.discovery.windowSec)
  })

  it('does not reset TTL on subsequent requests (ttl > 0)', async () => {
    const redis = createRedisMock(3)
    redis.ttl = mock(() => Promise.resolve(500))
    await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('blocks requests at the limit', async () => {
    const redis = createRedisMock(RATE_LIMITS.discovery.max + 1)
    redis.ttl = mock(() => Promise.resolve(500))
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(500)
  })

  it('fails open on Redis error', async () => {
    const redis = {
      incr: mock(() => Promise.reject(new Error('connection refused'))),
      expire: mock(() => Promise.resolve(1)),
      ttl: mock(() => Promise.resolve(-1)),
    }
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
  })
})
