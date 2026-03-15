import type { Redis } from 'ioredis'
import { RATE_LIMITS, type RateLimitAction } from './constants'

const LUA_INCR_WITH_EXPIRE = `
  local c = redis.call('INCR', KEYS[1])
  if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local t = redis.call('TTL', KEYS[1])
  return {c, t}
`

interface RateLimitResult {
  allowed: boolean
  current: number
  retryAfter: number
}

export async function checkRateLimit(redis: Redis, ip: string, action: RateLimitAction): Promise<RateLimitResult> {
  const { max, windowSec } = RATE_LIMITS[action]
  const key = `ratelimit:${action}:${ip}`

  try {
    const [current, ttl] = (await redis.eval(LUA_INCR_WITH_EXPIRE, 1, key, windowSec)) as [number, number]

    if (current > max) {
      console.warn(`[RATE_LIMIT] ip=${ip} action=${action} count=${current} limit=${max}`)
      return { allowed: false, current, retryAfter: ttl > 0 ? ttl : windowSec }
    }

    return { allowed: true, current, retryAfter: 0 }
  } catch (err) {
    console.error(`[RATE_LIMIT] Redis error for ${action}:${ip}:`, err)
    return { allowed: true, current: 0, retryAfter: 0 }
  }
}
