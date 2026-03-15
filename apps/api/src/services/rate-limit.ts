import type { Redis } from 'ioredis'

export const RATE_LIMITS = {
  discovery: { max: 5, windowSec: 15 * 60 },
  refresh: { max: 20, windowSec: 15 * 60 },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

interface RateLimitResult {
  allowed: boolean
  current: number
  retryAfter: number
}

export async function checkRateLimit(redis: Redis, ip: string, action: RateLimitAction): Promise<RateLimitResult> {
  const { max, windowSec } = RATE_LIMITS[action]
  const key = `ratelimit:${action}:${ip}`

  try {
    const current = await redis.incr(key)

    // Set TTL only on first increment (key was just created)
    if (current === 1 || (await redis.ttl(key)) === -1) {
      await redis.expire(key, windowSec)
    }

    if (current > max) {
      const ttl = await redis.ttl(key)
      console.warn(`[RATE_LIMIT] ip=${ip} action=${action} count=${current} limit=${max}`)
      return { allowed: false, current, retryAfter: ttl > 0 ? ttl : windowSec }
    }

    return { allowed: true, current, retryAfter: 0 }
  } catch (err) {
    console.error(`[RATE_LIMIT] Redis error for ${action}:${ip}:`, err)
    return { allowed: true, current: 0, retryAfter: 0 }
  }
}
