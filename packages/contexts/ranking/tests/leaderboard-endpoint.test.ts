import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { fetchLeaderboardPage } from '../commands/leaderboard-endpoint'

const ORIGINAL_FETCH = globalThis.fetch

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => impl(String(input))) as typeof fetch
}

describe('fetchLeaderboardPage', () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('builds the correct URL with the requested region', async () => {
    let captured = ''
    mockFetch((url) => {
      captured = url
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '1v1', page: 7, region: 'US-E' })
    expect(captured).toBe(
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=US-E&game_mode=1v1&page=7&max_results=50&leaderboard=prod',
    )
  })

  it('passes JPN through unchanged in the URL', async () => {
    let captured = ''
    mockFetch((url) => {
      captured = url
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '1v1', page: 1, region: 'JPN' })
    expect(captured).toContain('region=JPN')
    expect(captured).not.toContain('region=JPS')
  })

  it('passes through other region codes unchanged', async () => {
    let captured = ''
    mockFetch((url) => {
      captured = url
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '2v2', page: 3, region: 'EU' })
    expect(captured).toContain('region=EU')
  })

  it('returns parsed body on 200', async () => {
    mockFetch(() => new Response(JSON.stringify({ rankings: [{ id: 1 }], total_pages: 5 }), { status: 200 }))
    const body = await fetchLeaderboardPage({ bracket: '2v2', page: 1, region: 'EU' })
    expect(body).toEqual({ rankings: [{ id: 1 } as never], total_pages: 5 })
  })

  it('retries once on 5xx, then succeeds', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      if (calls === 1) return new Response('boom', { status: 503 })
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '3v3', page: 1, region: 'EU' })
    expect(calls).toBe(2)
  })

  it('throws after all retries exhausted', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return new Response('boom', { status: 502 })
    })
    await expect(fetchLeaderboardPage({ bracket: '1v1', page: 1, region: 'US-E' })).rejects.toThrow()
    expect(calls).toBe(3) // initial + 2 retries
  })

  it('retries up to twice on persistent 5xx, then succeeds on third attempt', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      if (calls < 3) return new Response('boom', { status: 503 })
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '1v1', page: 1, region: 'US-E' })
    expect(calls).toBe(3)
  })

  it('treats network throws as retryable', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      if (calls === 1) throw new Error('network')
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: 'solo_2v2', page: 9, region: 'SEA' })
    expect(calls).toBe(2)
  })
})
