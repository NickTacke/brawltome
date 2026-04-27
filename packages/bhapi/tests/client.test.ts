import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { BhApiClient } from '../src/client'

let server: ReturnType<typeof Bun.serve>
let lastUrl = ''

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      lastUrl = req.url
      return new Response('null', { headers: { 'content-type': 'application/json' } })
    },
  })
})

afterAll(() => {
  server.stop()
})

describe('searchBySteamId', () => {
  it('encodes special characters in steamId', async () => {
    const client = new BhApiClient({
      apiKey: 'test',
      baseUrl: `http://localhost:${server.port}`,
    })
    await client.init()
    await client.searchBySteamId('foo&bar=baz')
    const parsed = new URL(lastUrl)
    expect(parsed.searchParams.get('steamid')).toBe('foo&bar=baz')
    expect(parsed.searchParams.get('bar')).toBeNull()
  })
})
