import { describe, expect, test } from 'bun:test'
import {
  type LeaderboardMode,
  LeaderboardSourceError,
  decodeLeaderboardPage,
  fetchLeaderboardPage,
} from '../v1-leaderboard-source'

const metrics = {
  rating: 2100,
  best_rating: 2200,
  rank: 1,
  wins: 20,
  losses: 10,
  region: 'EU' as const,
  tier: 'Diamond',
}

const player = (id: number, username: string) => ({ id, username })
const realShapedRows: Record<LeaderboardMode, unknown> = {
  '1v1': { ...metrics, players: [player(42, 'Ada')] },
  '2v2': { ...metrics, players: [player(9, 'Nix'), player(3, 'Bodvar')] },
  solo2v2: { ...metrics, players: [player(43, 'Solo Ada')] },
  '3v3': { ...metrics, players: [player(44, 'Three Ada')] },
}

function decode(mode: LeaderboardMode, row: unknown = realShapedRows[mode]) {
  return decodeLeaderboardPage({ rankings: [row], total_pages: 4, additive: true }, { mode, region: 'EU', page: 1 })
}

describe('V1 ranked leaderboard source', () => {
  test('decodes every live-shaped mode into an explicit non-interchangeable identity', () => {
    expect(decode('1v1').rankings[0].identity).toEqual({
      type: 'one-vs-one-player',
      player: player(42, 'Ada'),
    })
    expect(decode('2v2').rankings[0].identity).toEqual({
      type: 'fixed-two-vs-two-team',
      players: [player(3, 'Bodvar'), player(9, 'Nix')],
    })
    expect(decode('solo2v2').rankings[0].identity).toEqual({
      type: 'solo-two-vs-two-player',
      player: player(43, 'Solo Ada'),
    })
    expect(decode('3v3').rankings[0].identity).toEqual({
      type: 'three-vs-three-player',
      player: player(44, 'Three Ada'),
    })
  })

  test('accepts additive fields, preserves supported row regions, and normalizes the provider JPS alias', () => {
    const row = { ...(realShapedRows['1v1'] as object), region: 'US-E', additive: true }
    expect(decode('1v1', row).rankings[0]).toMatchObject({ region: 'US-E', rating: 2100 })
    expect(decode('1v1', { ...row, region: 'JPS' }).rankings[0]).toMatchObject({ region: 'JPN' })
  })

  test('preserves official same-account couch teams as distinct participant slots', () => {
    const row = {
      ...(realShapedRows['2v2'] as object),
      players: [player(91_850_384, 'Dounia-la_put921•2'), player(91_850_384, 'Dounia-la_put921')],
    }
    expect(decode('2v2', row).rankings[0].identity).toEqual({
      type: 'fixed-two-vs-two-team',
      players: [player(91_850_384, 'Dounia-la_put921'), player(91_850_384, 'Dounia-la_put921•2')],
    })
  })

  test('uses a deterministic identity label only when a present source username is blank', () => {
    const row = {
      ...(realShapedRows['2v2'] as object),
      players: [player(9, 'Nix'), player(3, '  ')],
    }
    expect(decode('2v2', row).rankings[0].identity).toEqual({
      type: 'fixed-two-vs-two-team',
      players: [player(3, 'Name unavailable #3'), player(9, 'Nix')],
    })
    expect(() => decode('2v2', { ...row, players: [player(9, 'Nix'), { id: 3 }] })).toThrow(LeaderboardSourceError)
  })

  test('rejects zero, duplicate, missing, or cardinality-drifted contestants for every mode', () => {
    for (const mode of ['1v1', 'solo2v2', '3v3'] as const) {
      for (const players of [[], [player(0, 'Sentinel')], [player(1, 'A'), player(2, 'B')]]) {
        expect(() => decode(mode, { ...metrics, players })).toThrow(
          expect.objectContaining({ code: 'source_contract_invalid', retryable: false }),
        )
      }
    }
    for (const players of [
      [],
      [player(1, 'A')],
      [player(0, 'Sentinel'), player(2, 'B')],
      [player(1, 'A'), player(2, 'B'), player(3, 'C')],
    ]) {
      expect(() => decode('2v2', { ...metrics, players })).toThrow(
        expect.objectContaining({ code: 'source_contract_invalid', retryable: false }),
      )
    }
    expect(() => decode('2v2', { ...metrics, players: [player(1, 'A'), player(1, 'A')] })).toThrow(
      expect.objectContaining({ code: 'source_data_inconsistent', retryable: true }),
    )
  })

  test('rejects malformed or drifted required semantics', () => {
    const valid = realShapedRows['1v1'] as Record<string, unknown>
    for (const body of [
      null,
      [],
      { rankings: [], total_pages: 0 },
      { rankings: [{ ...valid, players: [{ id: 42 }] }], total_pages: 1 },
      { rankings: [{ ...valid, players: undefined, id: 42, username: 'Ada' }], total_pages: 1 },
      { rankings: [{ ...valid, rating: Number.NaN }], total_pages: 1 },
      { rankings: [{ ...valid, best_rating: 2099 }], total_pages: 1 },
      { rankings: [{ ...valid, rank: 1.5 }], total_pages: 1 },
      { rankings: [{ ...valid, wins: -1 }], total_pages: 1 },
      { rankings: [{ ...valid, wins: 2_147_483_647, losses: 1 }], total_pages: 1 },
      { rankings: [{ ...valid, region: 'OTHER' }], total_pages: 1 },
      { rankings: [{ ...valid, tier: '' }], total_pages: 1 },
    ]) {
      expect(() => decodeLeaderboardPage(body, { mode: '1v1', region: 'EU', page: 1 })).toThrow(LeaderboardSourceError)
    }
  })

  test('uses the exact bounded V1 game_mode values and never requests Global', async () => {
    const urls: string[] = []
    const modes = ['1v1', '2v2', 'solo2v2', '3v3'] as const
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input))
      const mode = modes[urls.length - 1]
      return new Response(JSON.stringify({ rankings: [realShapedRows[mode]], total_pages: 1 }))
    }
    for (const mode of modes) await fetchLeaderboardPage({ mode, region: 'JPN', page: 1 }, { fetcher })
    expect(urls).toEqual([
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=JPN&game_mode=1v1&page=1&max_results=50&leaderboard=prod',
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=JPN&game_mode=2v2&page=1&max_results=50&leaderboard=prod',
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=JPN&game_mode=solo_2v2&page=1&max_results=50&leaderboard=prod',
      'https://api.brawlhalla.com/v1/leaderboard/ranked?region=JPN&game_mode=3v3&page=1&max_results=50&leaderboard=prod',
    ])
    await expect(fetchLeaderboardPage({ mode: '3v3', region: 'all' as never, page: 1 }, { fetcher })).rejects.toThrow()
  })

  test('reports provider Retry-After before classifying a rate limit for durable retry', async () => {
    const backoffs: number[] = []
    await expect(
      fetchLeaderboardPage(
        { mode: '1v1', region: 'EU', page: 1 },
        {
          fetcher: async () => new Response('busy', { status: 429, headers: { 'retry-after': '12' } }),
          onRateLimited: async (seconds) => {
            backoffs.push(seconds)
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'source_rate_limited', retryable: true })
    expect(backoffs).toEqual([13])
  })

  test('classifies response drift and transport failures for durable retries', async () => {
    const malformed = () => Promise.resolve(new Response(JSON.stringify({ rankings: [{}], total_pages: 1 })))
    const unavailable = () => Promise.resolve(new Response('busy', { status: 503 }))
    const missing = () => Promise.resolve(new Response('nope', { status: 404 }))

    await expect(
      fetchLeaderboardPage({ mode: '3v3', region: 'EU', page: 1 }, { fetcher: malformed }),
    ).rejects.toMatchObject({
      code: 'source_contract_invalid',
      retryable: false,
    })
    await expect(
      fetchLeaderboardPage({ mode: '3v3', region: 'EU', page: 1 }, { fetcher: unavailable }),
    ).rejects.toMatchObject({
      code: 'source_unavailable',
      retryable: true,
    })
    await expect(
      fetchLeaderboardPage({ mode: '3v3', region: 'EU', page: 1 }, { fetcher: missing }),
    ).rejects.toMatchObject({
      code: 'source_not_found',
      retryable: false,
    })
  })
})
