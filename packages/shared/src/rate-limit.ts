import type { Redis } from 'ioredis'
import type { MetricsRegistry } from './metrics'

export const RATE_LIMITS = {
  discovery: { max: 20, windowSec: 15 * 60, failMode: 'closed' as const },
  refresh: { max: 20, windowSec: 15 * 60, failMode: 'open' as const },
  'discovery:global': { max: 30, windowSec: 15 * 60, failMode: 'closed' as const },
  overlay: { max: 60, windowSec: 15 * 60, failMode: 'open' as const },
  ingest: { max: 60, windowSec: 15 * 60, failMode: 'closed' as const },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

const LUA_INCR_WITH_EXPIRE = `
  local c = redis.call('INCR', KEYS[1])
  if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  local t = redis.call('TTL', KEYS[1])
  return {c, t}
`

export interface RateLimitResult {
  allowed: boolean
  current: number
  retryAfter: number
}

export async function checkRateLimit(
  redis: Redis,
  ip: string,
  action: RateLimitAction,
  metrics?: MetricsRegistry,
): Promise<RateLimitResult> {
  const { max, windowSec, failMode } = RATE_LIMITS[action]
  const key = `ratelimit:${action}:${ip}`

  try {
    const [current, ttl] = (await redis.eval(LUA_INCR_WITH_EXPIRE, 1, key, windowSec)) as [number, number]

    if (current > max) {
      console.warn(`[RATE_LIMIT] ip=${ip} action=${action} count=${current} limit=${max}`)
      return { allowed: false, current, retryAfter: ttl > 0 ? ttl : windowSec }
    }

    return { allowed: true, current, retryAfter: 0 }
  } catch (err) {
    console.error(`[RATE_LIMIT] Redis error for ${action}:${ip} (failMode=${failMode}):`, err)
    await metrics?.incrementCounter(`ratelimit:redis_errors:${action}:${failMode}`)
    if (failMode === 'closed') {
      return { allowed: false, current: 0, retryAfter: windowSec }
    }
    return { allowed: true, current: 0, retryAfter: 0 }
  }
}
