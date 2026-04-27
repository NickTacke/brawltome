import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import Redis from 'ioredis'
import { BhApiClient } from '../src/client'

let redis: Redis
let server: ReturnType<typeof Bun.serve>
let lastUrl = ''

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  server = Bun.serve({
    port: 0,
    fetch(req) {
      lastUrl = req.url
      return new Response('null', { headers: { 'content-type': 'application/json' } })
    },
  })
})

afterAll(async () => {
  server.stop()
  const keys = await redis.keys('bhapi:test*')
  if (keys.length > 0) await redis.del(...keys)
  await redis.quit()
})

describe('searchBySteamId', () => {
  it('encodes special characters in steamId', async () => {
    const client = new BhApiClient({
      apiKey: 'test',
      baseUrl: `http://localhost:${server.port}`,
      persistence: { redis, keyPrefix: 'bhapi:test' },
    })
    await client.init()
    await client.searchBySteamId('foo&bar=baz')
    expect(lastUrl).toContain('steamid=foo%26bar%3Dbaz')
  })
})
