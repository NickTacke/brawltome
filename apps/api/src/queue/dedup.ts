import type { Redis } from 'ioredis'

export async function tryDedup(redis: Redis, key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX')
  return result === 'OK'
}

export function dedupKey(type: string, id: number): string {
  return `dedup:${type}:${id}`
}
