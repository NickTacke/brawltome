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
        await Bun.sleep(500)
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
      await expect(client.getRankings1v1('us-e', 1)).rejects.toThrow(/Brawlhalla API timeout for/)
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

  it('routes body-read timeout to bhapi:timeouts not bhapi:json_errors', async () => {
    // Server sends headers fast (200 OK) but stalls in the body - exactly the body-read
    // timeout case where AbortSignal.timeout fires during res.json().
    const slowBody = Bun.serve({
      port: 0,
      async fetch() {
        // Stream that emits headers immediately but stalls the body.
        const stream = new ReadableStream({
          start(controller) {
            // Send a partial JSON token, then never close.
            controller.enqueue(new TextEncoder().encode('{'))
            // intentionally do not close - body read will timeout
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const counters: string[] = []
    const metrics = {
      incrementCounter: async (key: string) => {
        counters.push(key)
      },
    }

    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${slowBody.port}`,
        fetchTimeoutMs: 100,
        metrics,
      })
      await client.init()
      await expect(client.getRankings1v1('us-e', 1)).rejects.toThrow(/Brawlhalla API timeout for/)
    } finally {
      slowBody.stop()
    }

    expect(counters).toContain('bhapi:timeouts')
    expect(counters).not.toContain('bhapi:json_errors')
  })
})
