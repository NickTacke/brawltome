import { describe, expect, test } from 'bun:test'
import { BrawltoolsHttpError, BrawltoolsRateLimitError, createBrawltoolsClient } from '../source/brawltools-client'
import type { RawMatch } from '../source/raw-types'

type FetchCall = { url: URL; init: RequestInit | undefined }

function stubFetch(respond: (url: URL) => Response) {
  const calls: FetchCall[] = []

  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))

    calls.push({ url, init })

    return respond(url)
  }) as typeof fetch

  return { stub, calls }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

const admitNothing = async () => {}

describe('brawltools client', () => {
  test('calls admit before every request', async () => {
    const events: string[] = []

    const { stub } = stubFetch(() => {
      events.push('fetch')

      return json({ player: { playerId: 7, name: 'Someone', brawlhallaId: 1 } })
    })

    const client = createBrawltoolsClient({
      fetch: stub,
      admit: async () => {
        events.push('admit')
      },
    })

    await client.playerByBrawlhallaId(1)
    await client.playerByBrawlhallaId(1)

    expect(events).toEqual(['admit', 'fetch', 'admit', 'fetch'])
  })

  test('does not fetch when admit refuses', async () => {
    const { stub, calls } = stubFetch(() => json({}))

    const client = createBrawltoolsClient({
      fetch: stub,
      admit: async () => {
        throw new Error('rate limited')
      },
    })

    await expect(client.playerByBrawlhallaId(1)).rejects.toThrow('rate limited')
    expect(calls).toHaveLength(0)
  })

  test('unwraps the player from /player/bhId/{id}', async () => {
    const body = { player: { playerId: 149305, name: 'BBBalloonBoy', brawlhallaId: 9 } }
    const { stub, calls } = stubFetch(() => json(body))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    const player = await client.playerByBrawlhallaId(9)

    expect(player).toMatchObject({ playerId: 149305, name: 'BBBalloonBoy' })
    expect(calls[0]?.url.href).toBe('https://api.brawltools.com/v2/player/bhId/9')
  })

  test('returns null for a 404 player', async () => {
    const { stub } = stubFetch(() => json({ error: 'not found' }, 404))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.playerByBrawlhallaId(1)).toBeNull()
  })

  test('parses pr for game mode 2 from /player/pr?playerIds=7&gameMode=2', async () => {
    const pr = { earnings: 10, pr: { top8: 1, top32: 2, gold: 0, silver: 0, bronze: 1, powerRanking: 4, region: 'EU' } }
    const { stub, calls } = stubFetch(() => json(pr))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.powerRanking(7, 2)).toEqual(pr)

    const url = calls[0]?.url

    expect(url?.pathname).toBe('/v2/player/pr')
    expect(url?.searchParams.get('playerIds')).toBe('7')
    expect(url?.searchParams.get('gameMode')).toBe('2')
  })

  test('returns null for a 404 power ranking', async () => {
    const { stub } = stubFetch(() => json({}, 404))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.powerRanking(7, 1)).toBeNull()
  })

  test('sends maxResults=50 for placements and unwraps the list', async () => {
    const tournament = { id: 't1', tournamentName: 'Cup', isOfficial: true, isOnline: false, startTime: 1 }
    const placement = { placement: 1, tournament }
    const { stub, calls } = stubFetch(() => json({ playerPlacements: [placement], nextToken: 'x' }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.placements(7, 1)).toEqual([placement])

    const url = calls[0]?.url

    expect(url?.pathname).toBe('/v2/player/placement')
    expect(url?.searchParams.get('playerIds')).toBe('7')
    expect(url?.searchParams.get('gameMode')).toBe('1')
    expect(url?.searchParams.get('maxResults')).toBe('50')
  })

  test('returns no placements for a 404', async () => {
    const { stub } = stubFetch(() => json({}, 404))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.placements(7, 1)).toEqual([])
  })

  test('asks for the sets of one tournament', async () => {
    const match: RawMatch = { matchId: 'm1', scores: [3, 1], legends: [[], []], opponent: [], startTime: 5 }
    const { stub, calls } = stubFetch(() => json({ playerMatches: [match] }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.matches(7, 'abc-123')).toEqual([match])

    const url = calls[0]?.url

    expect(url?.pathname).toBe('/v2/player/match')
    expect(url?.searchParams.get('playerIds')).toBe('7')
    expect(url?.searchParams.get('tournamentId')).toBe('abc-123')
  })

  test('asks for the ten most played event legends', async () => {
    const legends = [{ name: 'ZARIEL', count: 249 }]
    const { stub, calls } = stubFetch(() => json({ legends, nextToken: 'x' }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    expect(await client.eventLegends(7)).toEqual(legends)

    const url = calls[0]?.url

    expect(url?.pathname).toBe('/v2/player/legend')
    expect(url?.searchParams.get('playerIds')).toBe('7')
    expect(url?.searchParams.get('maxResults')).toBe('10')
  })

  test('refuses redirects and sets a timeout signal', async () => {
    const { stub, calls } = stubFetch(() => json({ legends: [] }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    await client.eventLegends(7)

    expect(calls[0]?.init?.redirect).toBe('error')
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  test('uses the base url it is given', async () => {
    const { stub, calls } = stubFetch(() => json({ legends: [] }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing, baseUrl: 'http://localhost:9/v2' })

    await client.eventLegends(7)

    expect(calls[0]?.url.href).toStartWith('http://localhost:9/v2/player/legend?')
  })

  test('throws BrawltoolsRateLimitError with retryAfterSeconds 30 on a 429 with Retry-After: 30', async () => {
    const { stub } = stubFetch(() => new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    const error = await client.powerRanking(7, 1).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BrawltoolsRateLimitError)
    expect((error as BrawltoolsRateLimitError).retryAfterSeconds).toBe(30)
  })

  test('waits 60 seconds on a 429 without a usable Retry-After', async () => {
    const { stub } = stubFetch(() => new Response('slow down', { status: 429, headers: { 'Retry-After': 'soon' } }))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    const error = await client.powerRanking(7, 1).catch((caught: unknown) => caught)

    expect((error as BrawltoolsRateLimitError).retryAfterSeconds).toBe(60)
  })

  test('throws BrawltoolsHttpError with the status and a path without ids', async () => {
    const { stub } = stubFetch(() => json({ error: 'boom' }, 503))
    const client = createBrawltoolsClient({ fetch: stub, admit: admitNothing })

    const error = await client.playerByBrawlhallaId(95906862).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BrawltoolsHttpError)
    expect((error as BrawltoolsHttpError).status).toBe(503)
    expect((error as BrawltoolsHttpError).path).toBe('/player/bhId/:id')
    expect((error as BrawltoolsHttpError).message).not.toContain('95906862')
  })

  test('aborts after timeoutMs', async () => {
    const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof fetch

    const client = createBrawltoolsClient({ fetch: hangingFetch, admit: admitNothing, timeoutMs: 20 })

    await expect(client.eventLegends(7)).rejects.toThrow('timed out after 20 ms')
  })
})
