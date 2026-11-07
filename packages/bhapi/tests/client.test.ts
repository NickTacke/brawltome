import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { BhApiClient, RateLimitError } from '../src/client'

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

// ── v1 fixtures ──────────────────────────────────────────────────────────────
const PLAYER_ID = 5461700
const GUILD_ID = 2616365

const V1_GUILD_STATS = {
  guild_id: GUILD_ID,
  name: 'Test Guild',
  create_date: 1660419655,
  xp: 241855,
  legacy_xp: 4620759,
  notice: 'hi',
  tags: ['Social'],
  discord_invite_code: 'abc',
  guild_points: 114953,
  rank: 6184,
  is_recruiting: true,
  member_count: 3,
}

const V1_GUILD_MEMBERS = {
  guild_id: GUILD_ID,
  guild_members: [
    { brawlhalla_id: PLAYER_ID, name: 'Lopes', rank: 'Leader', join_date: 1660419655, xp: 1000, guild_points: 50 },
  ],
}

describe('searchBySteamId', () => {
  it('encodes special characters in steamId', async () => {
    const client = new BhApiClient({
      apiKey: 'test',
      baseUrl: `http://localhost:${server.port}`,
    })

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

      await expect(client.getPlayerRanked(PLAYER_ID)).rejects.toThrow(/Brawlhalla API timeout for/)
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

      await expect(client.getPlayerRanked(PLAYER_ID)).rejects.toThrow(/Invalid JSON/)
    } finally {
      html.stop()
    }
  })

  it('reports a body-read timeout as a timeout, not as invalid JSON', async () => {
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

    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${slowBody.port}`,
        fetchTimeoutMs: 100,
      })

      await expect(client.getPlayerRanked(PLAYER_ID)).rejects.toThrow(/Brawlhalla API timeout for/)
    } finally {
      slowBody.stop()
    }
  })

  it('reports finite source backoff when Retry-After is an HTTP-date (non-numeric)', async () => {
    let reportedBackoff: { domain: string; path: string; retryAfterMs: number } | undefined

    const rateLimit = Bun.serve({
      port: 0,
      fetch() {
        return new Response('null', {
          status: 429,
          headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        })
      },
    })

    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${rateLimit.port}`,
        onRateLimited: async (event) => {
          reportedBackoff = event
        },
      })

      let caught: unknown

      try {
        await client.getPlayerRanked(PLAYER_ID)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(RateLimitError)
      expect(Number.isFinite((caught as RateLimitError).retryAfterMs)).toBe(true)
      expect((caught as RateLimitError).retryAfterMs).toBeGreaterThan(0)

      expect(reportedBackoff).toEqual({
        domain: 'brawlhalla-v0',
        path: `/player/${PLAYER_ID}/ranked`,
        retryAfterMs: (caught as RateLimitError).retryAfterMs,
      })
    } finally {
      rateLimit.stop()
    }
  })

  it('HTTP-date Retry-After yields larger delay than the 5s fallback', async () => {
    const futureDate = new Date(Date.now() + 5 * 60_000).toUTCString()

    const rateLimit = Bun.serve({
      port: 0,
      fetch() {
        return new Response('null', {
          status: 429,
          headers: { 'retry-after': futureDate },
        })
      },
    })

    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${rateLimit.port}`,
      })

      let caught: unknown

      try {
        await client.getPlayerRanked(PLAYER_ID)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(RateLimitError)
      // ~5 min future date => retryAfter ~300s => pauseMs ~301000ms, well above 5s fallback (6000ms)
      expect((caught as RateLimitError).retryAfterMs).toBeGreaterThan(6_000)
    } finally {
      rateLimit.stop()
    }
  })
})

describe('v1 client', () => {
  let requestedStatsMode: string | null | undefined

  function makeV1Server() {
    return Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        const p = u.pathname
        const mode = u.searchParams.get('mode')

        if (p === '/v1/player/stats') {
          requestedStatsMode = mode

          return Response.json({ brawlhalla_id: PLAYER_ID })
        }

        if (p === '/v1/guild/stats') {
          return new Response(JSON.stringify(V1_GUILD_STATS), { headers: { 'content-type': 'application/json' } })
        }

        if (p === '/v1/guild/members') {
          return new Response(JSON.stringify(V1_GUILD_MEMBERS), { headers: { 'content-type': 'application/json' } })
        }

        return new Response(null, { status: 404 })
      },
    })
  }

  it('sends the stats mode only for ranked stats', async () => {
    const v1 = makeV1Server()

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })

      await client.getPlayerStatsV1Payload(PLAYER_ID, 'all')
      expect(requestedStatsMode).toBeNull()

      await client.getPlayerStatsV1Payload(PLAYER_ID, 'ranked_1v1')
      expect(requestedStatsMode).toBe('ranked_1v1')
    } finally {
      v1.stop()
    }
  })

  it('getGuildStatsV1 returns legacy_xp', async () => {
    const v1 = makeV1Server()

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      const result = await client.getGuildStatsV1(GUILD_ID)

      expect(result?.legacy_xp).toBe(4620759)
    } finally {
      v1.stop()
    }
  })

  it('getGuildMembersV1 returns guild_members[0].brawlhalla_id', async () => {
    const v1 = makeV1Server()

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      const result = await client.getGuildMembersV1(GUILD_ID)

      expect(result?.guild_members[0].brawlhalla_id).toBe(PLAYER_ID)
    } finally {
      v1.stop()
    }
  })

  it('marks an actual source attempt only after distributed admission succeeds', async () => {
    let attempts = 0

    const blocked = new BhApiClient({
      apiKey: 'test',
      baseUrl: `http://localhost:${server.port}`,
      beforeRequest: async () => {
        throw new Error('source admission blocked')
      },
    })

    await expect(blocked.getPlayerRanked(PLAYER_ID, { onAttempt: () => attempts++ })).rejects.toThrow(
      'source admission blocked',
    )

    expect(attempts).toBe(0)

    const admitted = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${server.port}` })

    await admitted.getPlayerRanked(PLAYER_ID, { onAttempt: () => attempts++ })
    expect(attempts).toBe(1)
  })

  it('returns sparse V1 player payloads unchanged', async () => {
    const sparseStats = { brawlhalla_id: PLAYER_ID, rating: 2700, games: 101 }

    const sparseTeams = {
      brawlhalla_id: PLAYER_ID,
      teams: { ranked_2v2: [{ brawlhalla_id_one: PLAYER_ID, brawlhalla_id_two: 42, wins: 7 }] },
    }

    const sparse = Bun.serve({
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname.endsWith('/teams')
          ? Response.json(sparseTeams)
          : Response.json(sparseStats)
      },
    })

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${sparse.port}` })

      expect(await client.getPlayerStatsV1Payload(PLAYER_ID, 'ranked_1v1')).toEqual(sparseStats)
      expect(await client.getPlayerTeamsV1Payload(PLAYER_ID)).toEqual(sparseTeams)
    } finally {
      sparse.stop()
    }
  })

  it('rejects a successful null payload', async () => {
    const nullPayload = Bun.serve({
      port: 0,
      fetch() {
        return Response.json(null)
      },
    })

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${nullPayload.port}` })

      await expect(client.getPlayerStatsV1Payload(PLAYER_ID)).rejects.toThrow('Invalid payload')
    } finally {
      nullPayload.stop()
    }
  })

  it('returns null on 404', async () => {
    const notFound = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, { status: 404 })
      },
    })

    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${notFound.port}` })
      const result = await client.getPlayerStatsV1Payload(PLAYER_ID)

      expect(result).toBeNull()
    } finally {
      notFound.stop()
    }
  })
})
