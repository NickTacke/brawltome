import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { fetchLeaderboardPage } from '../commands/leaderboard-endpoint'

const ORIGINAL_FETCH = globalThis.fetch

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => impl(String(input))) as typeof fetch
}

describe('fetchLeaderboardPage', () => {
  beforeEach(() => { globalThis.fetch = ORIGINAL_FETCH })
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH })

  it('builds the correct URL', async () => {
    let captured = ''
    mockFetch((url) => {
      captured = url
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '1v1', page: 7 })
    expect(captured).toBe(
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=ALL&game_mode=1v1&page=7&max_results=50&leaderboard=prod',
    )
  })

  it('returns parsed body on 200', async () => {
    mockFetch(() => new Response(JSON.stringify({ rankings: [{ id: 1 }], total_pages: 5 }), { status: 200 }))
    const body = await fetchLeaderboardPage({ bracket: '2v2', page: 1 })
    expect(body).toEqual({ rankings: [{ id: 1 } as never], total_pages: 5 })
  })

  it('retries once on 5xx, then succeeds', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      if (calls === 1) return new Response('boom', { status: 503 })
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: '3v3', page: 1 })
    expect(calls).toBe(2)
  })

  it('throws after second consecutive failure', async () => {
    mockFetch(() => new Response('boom', { status: 502 }))
    await expect(fetchLeaderboardPage({ bracket: '1v1', page: 1 })).rejects.toThrow()
  })

  it('treats network throws as retryable', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      if (calls === 1) throw new Error('network')
      return new Response(JSON.stringify({ rankings: [], total_pages: 1 }), { status: 200 })
    })
    await fetchLeaderboardPage({ bracket: 'solo_2v2', page: 9 })
    expect(calls).toBe(2)
  })
})
