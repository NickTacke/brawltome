import { describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'
import { RATE_LIMITS } from '../../apps/api/src/services/constants'
import { checkRateLimit } from '../../apps/api/src/services/rate-limit.service'

// Minimal Redis mock — eval returns [count, ttl]
function createRedisMock(count = 1, ttl = 900) {
  return {
    eval: mock(() => Promise.resolve([count, ttl])),
  }
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const redis = createRedisMock(1, 900)
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(1)
    expect(result.retryAfter).toBe(0)
  })

  it('blocks requests over the limit', async () => {
    const redis = createRedisMock(RATE_LIMITS.discovery.max + 1, 500)
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(500)
  })

  it('uses refresh action config', async () => {
    const redis = createRedisMock(RATE_LIMITS.refresh.max, 800)
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'refresh')
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(RATE_LIMITS.refresh.max)
    expect(result.retryAfter).toBe(0)
  })

  it('fails open on Redis error', async () => {
    const redis = {
      eval: mock(() => Promise.reject(new Error('connection refused'))),
    }
    const result = await checkRateLimit(redis as unknown as Redis, '1.2.3.4', 'discovery')
    expect(result.allowed).toBe(true)
  })
})
