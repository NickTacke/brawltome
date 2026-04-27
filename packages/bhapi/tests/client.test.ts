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

describe('fetch hardening', () => {
  it('throws timeout error when upstream hangs', async () => {
    const slow = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(5000)
        return new Response('null')
      },
    })
    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${slow.port}`,
        fetchTimeoutMs: 100,
      })
      await client.init()
      await expect(client.getRankings1v1('us-e', 1)).rejects.toThrow(/timeout/i)
    } finally {
      slow.stop()
    }
  })

  it('throws Invalid JSON error on non-JSON response', async () => {
    const html = Bun.serve({
      port: 0,
      fetch() {
        return new Response('<html>oops</html>', { headers: { 'content-type': 'text/html' } })
      },
    })
    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${html.port}`,
      })
      await client.init()
      await expect(client.getRankings1v1('us-e', 1)).rejects.toThrow(/Invalid JSON/)
    } finally {
      html.stop()
    }
  })
})
