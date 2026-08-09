import { describe, expect, test } from 'bun:test'
import { LeaderboardSourceError, decode1v1LeaderboardPage, fetch1v1LeaderboardPage } from '../v1-leaderboard-source'

const sourceRow = {
  players: [{ id: 42, username: 'Ada' }],
  rating: 2100,
  best_rating: 2200,
  rank: 1,
  wins: 20,
  losses: 10,
  region: 'EU' as const,
  tier: 'Diamond',
}

describe('V1 1v1 leaderboard source', () => {
  test('accepts additive unknown fields while decoding required semantics', () => {
    expect(
      decode1v1LeaderboardPage(
        { rankings: [{ ...sourceRow, additive: true }], total_pages: 4, new_envelope_field: 'safe' },
        { region: 'EU', page: 1 },
      ),
    ).toEqual({
      rankings: [
        {
          id: 42,
          username: 'Ada',
          rating: 2100,
          best_rating: 2200,
          rank: 1,
          wins: 20,
          losses: 10,
          region: 'EU',
          tier: 'Diamond',
        },
      ],
      totalPages: 4,
    })
  })

  test('preserves a supported player region that differs from the requested leaderboard scope', () => {
    const decoded = decode1v1LeaderboardPage(
      { rankings: [{ ...sourceRow, region: 'US-E' }], total_pages: 1 },
      { region: 'EU', page: 1 },
    )
    expect(decoded.rankings[0].region).toBe('US-E')
  })

  test('rejects malformed, missing, drifted, or unsupported required semantics', () => {
    for (const body of [
      null,
      [],
      { rankings: [], total_pages: 0 },
      { rankings: [{ ...sourceRow, players: [] }], total_pages: 1 },
      { rankings: [{ ...sourceRow, players: [{ id: 0, username: 'Ada' }] }], total_pages: 1 },
      { rankings: [{ ...sourceRow, players: [{ id: 42, username: '  ' }] }], total_pages: 1 },
      {
        rankings: [
          {
            ...sourceRow,
            players: [
              { id: 42, username: 'Ada' },
              { id: 43, username: 'Bodvar' },
            ],
          },
        ],
        total_pages: 1,
      },
      { rankings: [{ ...sourceRow, players: undefined, id: 42, username: 'Ada' }], total_pages: 1 },
      { rankings: [{ ...sourceRow, rating: Number.NaN }], total_pages: 1 },
      { rankings: [{ ...sourceRow, best_rating: 2099 }], total_pages: 1 },
      { rankings: [{ ...sourceRow, rank: 1.5 }], total_pages: 1 },
      { rankings: [{ ...sourceRow, wins: -1 }], total_pages: 1 },
      { rankings: [{ ...sourceRow, wins: 2_147_483_647, losses: 1 }], total_pages: 1 },
      { rankings: [{ ...sourceRow, region: 'OTHER' }], total_pages: 1 },
      { rankings: [{ ...sourceRow, tier: '' }], total_pages: 1 },
    ]) {
      expect(() => decode1v1LeaderboardPage(body, { region: 'EU', page: 1 })).toThrow(LeaderboardSourceError)
    }
  })

  test('uses the exact bounded V1 URL and never rewrites JPN or requests all', async () => {
    const urls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ rankings: [{ ...sourceRow, region: 'JPN' }], total_pages: 1 }))
    }
    await fetch1v1LeaderboardPage({ region: 'JPN', page: 1 }, { fetcher })
    expect(urls).toEqual([
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=JPN&game_mode=1v1&page=1&max_results=50&leaderboard=prod',
    ])
    await expect(fetch1v1LeaderboardPage({ region: 'all' as never, page: 1 }, { fetcher })).rejects.toThrow()
  })

  test('classifies response drift and transport failures for durable retries', async () => {
    const malformed = () => Promise.resolve(new Response(JSON.stringify({ rankings: [{}], total_pages: 1 })))
    const unavailable = () => Promise.resolve(new Response('busy', { status: 503 }))
    const missing = () => Promise.resolve(new Response('nope', { status: 404 }))

    await expect(fetch1v1LeaderboardPage({ region: 'EU', page: 1 }, { fetcher: malformed })).rejects.toMatchObject({
      code: 'source_contract_invalid',
      retryable: false,
    })
    await expect(fetch1v1LeaderboardPage({ region: 'EU', page: 1 }, { fetcher: unavailable })).rejects.toMatchObject({
      code: 'source_unavailable',
      retryable: true,
    })
    await expect(fetch1v1LeaderboardPage({ region: 'EU', page: 1 }, { fetcher: missing })).rejects.toMatchObject({
      code: 'source_not_found',
      retryable: false,
    })
  })
})
