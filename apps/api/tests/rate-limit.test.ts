import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { RATE_LIMITS, checkRateLimit } from '@brawltome/shared'
import Redis from 'ioredis'

process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused'

let redis: Redis

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
})

afterAll(async () => {
  const keys = await redis.keys('ratelimit:overlay:*')
  if (keys.length > 0) await redis.del(...keys)
  await redis.quit()
})

describe('overlay rate limit', () => {
  it('defines overlay action with 60 per 15 min', () => {
    expect(RATE_LIMITS.overlay).toEqual({ max: 60, windowSec: 15 * 60, failMode: 'open' })
  })

  it('allows up to max, blocks beyond', async () => {
    const ip = `test-overlay-${Date.now()}`
    for (let i = 0; i < RATE_LIMITS.overlay.max; i++) {
      const res = await checkRateLimit(redis, ip, 'overlay')
      expect(res.allowed).toBe(true)
    }
    const blocked = await checkRateLimit(redis, ip, 'overlay')
    expect(blocked.allowed).toBe(false)
  })
})

describe('fail mode on Redis error', () => {
  it('blocks fail-closed action when Redis is down', async () => {
    const broken = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    await broken.quit()
    const result = await checkRateLimit(broken, `test-fail-closed-${Date.now()}`, 'discovery')
    expect(result.allowed).toBe(false)
  })

  it('allows fail-open action when Redis is down', async () => {
    const broken = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    await broken.quit()
    const result = await checkRateLimit(broken, `test-fail-open-${Date.now()}`, 'overlay')
    expect(result.allowed).toBe(true)
  })
})
