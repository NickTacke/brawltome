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

const V1_STATS_ALL = {
  brawlhalla_id: PLAYER_ID,
  name: 'Lopes',
  games: 100,
  wins: 60,
  damage_bomb: 10,
  damage_mine: 0,
  damage_spikeball: 0,
  damage_sidekick: 0,
  hit_snowball: 0,
  ko_bomb: 1,
  ko_mine: 0,
  ko_sidekick: 0,
  ko_snowball: 0,
  ko_spikeball: 0,
  region_ranks: [],
  legends: [
    {
      legend_id: 3,
      games: 50,
      wins: 30,
      damage_dealt: 1000,
      damage_taken: 900,
      kos: 40,
      falls: 35,
      suicides: 1,
      team_kos: 0,
      match_time: 3000,
      damage_unarmed: 10,
      damage_thrown_item: 5,
      damage_weapon_one: 400,
      damage_weapon_two: 300,
      damage_gadgets: 20,
      ko_unarmed: 1,
      ko_weapon_one: 15,
      ko_weapon_two: 12,
      ko_gadgets: 1,
      time_held_weapon_one: 1200,
      time_held_weapon_two: 1500,
    },
  ],
}

const V1_STATS_RANKED = {
  brawlhalla_id: PLAYER_ID,
  name: 'Lopes',
  games: 100,
  wins: 60,
  rating: 2700,
  peak_rating: 2750,
  tier: 'Valhallan',
  region: 'BRZ',
  region_ranks: [],
  legends: [{ legend_id: 3, games: 50, wins: 30, rating: 2600, peak_rating: 2650, tier: 'Diamond' }],
}

const V1_TEAMS = {
  brawlhalla_id: PLAYER_ID,
  teams: {
    ranked_2v2: [
      {
        brawlhalla_id_one: PLAYER_ID,
        brawlhalla_id_two: 2467374,
        username_one: 'Lopes',
        username_two: 'Upyri',
        rating: 1600,
        peak_rating: 1700,
        tier: 'Gold 4',
        wins: 40,
        games: 80,
        region: 'BRZ',
        region_ranks: [],
        global_rank: 195136,
      },
    ],
  },
}

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

const V1_LEGENDS_PAGE_1 = {
  legends: [
    {
      legend_id: 3,
      legend_name: 'bodvar',
      bio_name: 'Bödvar',
      bio_aka: '',
      bio_quote: '',
      bio_quote_about_attrib: '',
      bio_quote_from: '',
      bio_quote_from_attrib: '',
      bio_text: '',
      bot_name: '',
      weapon_one: 'Hammer',
      weapon_two: 'Sword',
      strength: 6,
      dexterity: 6,
      defense: 4,
      speed: 4,
    },
  ],
  total_pages: 2,
}

const V1_LEGENDS_PAGE_2 = {
  legends: [
    {
      legend_id: 4,
      legend_name: 'cassidy',
      bio_name: 'Cassidy',
      bio_aka: '',
      bio_quote: '',
      bio_quote_about_attrib: '',
      bio_quote_from: '',
      bio_quote_from_attrib: '',
      bio_text: '',
      bot_name: '',
      weapon_one: 'Pistol',
      weapon_two: 'Hammer',
      strength: 4,
      dexterity: 6,
      defense: 4,
      speed: 6,
    },
  ],
  total_pages: 2,
}

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

  it('rejects with finite retryAfterMs when Retry-After is an HTTP-date (non-numeric)', async () => {
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
      })
      await client.init()
      let caught: unknown
      try {
        await client.getRankings1v1('us-e', 1)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(RateLimitError)
      expect(Number.isFinite((caught as RateLimitError).retryAfterMs)).toBe(true)
      expect((caught as RateLimitError).retryAfterMs).toBeGreaterThan(0)
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
      await client.init()
      let caught: unknown
      try {
        await client.getRankings1v1('us-e', 1)
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
        const page = u.searchParams.get('page')

        if (p === '/v1/player/stats') requestedStatsMode = mode
        if (p === '/v1/player/stats' && (mode === null || mode === 'all')) {
          return new Response(JSON.stringify(V1_STATS_ALL), { headers: { 'content-type': 'application/json' } })
        }
        if (p === '/v1/player/stats' && mode === 'ranked_1v1') {
          return new Response(JSON.stringify(V1_STATS_RANKED), { headers: { 'content-type': 'application/json' } })
        }
        if (p === '/v1/player/teams') {
          return new Response(JSON.stringify(V1_TEAMS), { headers: { 'content-type': 'application/json' } })
        }
        if (p === '/v1/guild/stats') {
          return new Response(JSON.stringify(V1_GUILD_STATS), { headers: { 'content-type': 'application/json' } })
        }
        if (p === '/v1/guild/members') {
          return new Response(JSON.stringify(V1_GUILD_MEMBERS), { headers: { 'content-type': 'application/json' } })
        }
        if (p === '/v1/static/legends') {
          const body = page === '2' ? V1_LEGENDS_PAGE_2 : V1_LEGENDS_PAGE_1
          return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
        }
        return new Response(null, { status: 404 })
      },
    })
  }

  it('getPlayerStatsV1 mode=all returns damage fields as numbers + legends', async () => {
    const v1 = makeV1Server()
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      await client.init()
      const result = await client.getPlayerStatsV1(PLAYER_ID, 'all')
      expect(requestedStatsMode).toBeNull()
      expect(result).not.toBeNull()
      const stats = result as typeof V1_STATS_ALL
      expect(typeof stats.damage_bomb).toBe('number')
      expect(stats.legends).toHaveLength(1)
      expect(typeof stats.legends[0].damage_dealt).toBe('number')
    } finally {
      v1.stop()
    }
  })

  it('getPlayerStatsV1 mode=ranked_1v1 returns rating fields', async () => {
    const v1 = makeV1Server()
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      await client.init()
      const result = await client.getPlayerStatsV1(PLAYER_ID, 'ranked_1v1')
      expect(result).not.toBeNull()
      const ranked = result as typeof V1_STATS_RANKED
      expect(ranked.rating).toBe(2700)
      expect(ranked.tier).toBe('Valhallan')
    } finally {
      v1.stop()
    }
  })

  it('rejects teams for a different player', async () => {
    const mismatchedTeams = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ...V1_TEAMS, brawlhalla_id: PLAYER_ID + 1 })
      },
    })
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${mismatchedTeams.port}` })
      await client.init()
      expect(client.getPlayerTeamsV1(PLAYER_ID)).rejects.toThrow('player ID')
    } finally {
      mismatchedTeams.stop()
    }
  })

  it('getPlayerTeamsV1 returns teams.ranked_2v2[0].username_one', async () => {
    const v1 = makeV1Server()
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      await client.init()
      const result = await client.getPlayerTeamsV1(PLAYER_ID)
      expect(result?.teams.ranked_2v2[0].username_one).toBe('Lopes')
    } finally {
      v1.stop()
    }
  })

  it('rejects guild membership for a different player', async () => {
    const mismatchedGuild = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ brawlhalla_id: PLAYER_ID + 1, guild: {} })
      },
    })
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${mismatchedGuild.port}` })
      await client.init()
      expect(client.getPlayerGuildV1(PLAYER_ID)).rejects.toThrow('player ID')
    } finally {
      mismatchedGuild.stop()
    }
  })

  it('getGuildStatsV1 returns legacy_xp', async () => {
    const v1 = makeV1Server()
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${v1.port}` })
      await client.init()
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
      await client.init()
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
    await blocked.init()
    await expect(blocked.getPlayerRanked(PLAYER_ID, { onAttempt: () => attempts++ })).rejects.toThrow(
      'source admission blocked',
    )
    expect(attempts).toBe(0)

    const admitted = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${server.port}` })
    await admitted.init()
    await admitted.getPlayerRanked(PLAYER_ID, { onAttempt: () => attempts++ })
    expect(attempts).toBe(1)
  })

  it('admits every paginated V1 HTTP request at the request boundary', async () => {
    const v1 = makeV1Server()
    const admitted: Array<{ domain: string; path: string }> = []
    try {
      const client = new BhApiClient({
        apiKey: 'test',
        baseUrl: `http://localhost:${v1.port}`,
        beforeRequest: async (request) => {
          admitted.push(request)
        },
      })
      await client.init()
      const legends = await client.getAllLegendsV1()
      expect(legends).toHaveLength(2)
      expect(legends[0].legend_name).toBe('bodvar')
      expect(legends[1].legend_name).toBe('cassidy')
      expect(admitted).toEqual([
        { domain: 'brawlhalla-v1', path: '/static/legends' },
        { domain: 'brawlhalla-v1', path: '/static/legends' },
      ])
    } finally {
      v1.stop()
    }
  })

  it('returns sparse V1 player payloads without applying the legacy full-response validator', async () => {
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
      await client.init()
      expect(await client.getPlayerStatsV1Payload(PLAYER_ID, 'ranked_1v1')).toEqual(sparseStats)
      expect(await client.getPlayerTeamsV1Payload(PLAYER_ID)).toEqual(sparseTeams)
      await expect(client.getPlayerStatsV1(PLAYER_ID, 'ranked_1v1')).rejects.toThrow('name')
    } finally {
      sparse.stop()
    }
  })

  it('rejects stats without a legends array', async () => {
    const malformedStats = Bun.serve({
      port: 0,
      fetch() {
        const { legends: _, ...withoutLegends } = V1_STATS_ALL
        return Response.json(withoutLegends)
      },
    })
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${malformedStats.port}` })
      await client.init()
      expect(client.getPlayerStatsV1(PLAYER_ID)).rejects.toThrow('legends')
    } finally {
      malformedStats.stop()
    }
  })

  it('rejects stats for a different player', async () => {
    const mismatchedPlayer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ ...V1_STATS_ALL, brawlhalla_id: PLAYER_ID + 1 })
      },
    })
    try {
      const client = new BhApiClient({ apiKey: 'test', baseUrl: `http://localhost:${mismatchedPlayer.port}` })
      await client.init()
      expect(client.getPlayerStatsV1(PLAYER_ID)).rejects.toThrow('player ID')
    } finally {
      mismatchedPlayer.stop()
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
      await client.init()
      expect(client.getPlayerStatsV1(PLAYER_ID)).rejects.toThrow('Invalid payload')
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
      await client.init()
      const result = await client.getPlayerStatsV1(PLAYER_ID)
      expect(result).toBeNull()
    } finally {
      notFound.stop()
    }
  })
})
