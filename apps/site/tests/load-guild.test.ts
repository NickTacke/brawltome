import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { ClanProfileContract } from '@brawltome/contracts'
import { batchIds, loadGuild } from '../src/server/load-guild'

const apiUrl = 'http://api.test'
const provenance = { source: 'v1-guild-stats', outcome: 'success' } as const
const section = { checkedAt: null, checkProvenance: provenance, lastSuccessAt: null, lastSuccessProvenance: null }
const originalFetch = globalThis.fetch
const originalApiUrl = process.env.INTERNAL_API_URL
const originalSecret = process.env.INTERNAL_API_SECRET

type Call = { path: string; body: { ids: number[] } | null }
type Answer = { status: number; body: unknown }

function profile(memberCount: number): ClanProfileContract {
  const members = Array.from({ length: memberCount }, (_, index) => ({
    brawlhallaId: index + 1,
    name: `Player${index + 1}`,
    rank: 'Member',
    joinDate: null,
    xp: '1',
    guildPoints: null,
  }))

  return {
    clanId: 42,
    clanName: 'Valhalla',
    clanCreateDate: '2020-01-01T00:00:00.000Z',
    clanXp: '1',
    clanLifetimeXp: '2',
    notice: null,
    tags: null,
    discordInviteCode: null,
    guildPoints: null,
    isRecruiting: false,
    profile: section,
    roster: null,
    members,
  }
}

function summaryFor(brawlhallaId: number) {
  return { brawlhallaId, rating: 2000, wins: 1, games: 2, mainLegend: 'bodvar', updatedAt: null }
}

function respond(answer: Answer): Response {
  return new Response(JSON.stringify(answer.body), { status: answer.status })
}

function stubApi(answer: (call: Call) => Answer): Call[] {
  const calls: Call[] = []

  const stub = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = {
      path: String(input).replace(`${apiUrl}/v1`, ''),
      body: init.body ? JSON.parse(String(init.body)) : null,
    }

    calls.push(call)

    return respond(answer(call))
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return calls
}

function healthyAnswer(memberCount: number, call: Call): Answer {
  if (call.path === '/clans/42') return { status: 200, body: profile(memberCount) }

  if (call.path === '/clans/42/standing') return { status: 200, body: { guildPointsRank: 3, lifetimeXpRank: 9 } }

  return { status: 200, body: (call.body?.ids ?? []).map(summaryFor) }
}

function failingPath(memberCount: number, failing: string, call: Call): Answer {
  return call.path === failing ? { status: 503, body: {} } : healthyAnswer(memberCount, call)
}

describe('batchIds', () => {
  test('nothing to batch gives no batches', () => {
    expect(batchIds([])).toEqual([])
  })

  test('exactly one full batch stays one batch', () => {
    expect(batchIds(Array.from({ length: 250 }, (_, index) => index))).toHaveLength(1)
  })

  test('one id over the limit starts a second batch', () => {
    expect(batchIds(Array.from({ length: 251 }, (_, index) => index)).map((batch) => batch.length)).toEqual([250, 1])
  })
})

describe('loadGuild', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_URL = apiUrl
    process.env.INTERNAL_API_SECRET = 'test-internal-secret'
    spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.INTERNAL_API_URL = originalApiUrl
    process.env.INTERNAL_API_SECRET = originalSecret
    mock.restore()
  })

  test('returns the profile, standing and summaries', async () => {
    stubApi((call) => healthyAnswer(2, call))

    const guild = await loadGuild(42)

    expect(guild?.clan.clanName).toBe('Valhalla')
    expect(guild?.standing).toEqual({ guildPointsRank: 3, lifetimeXpRank: 9 })
    expect(guild?.summaries.map(({ brawlhallaId }) => brawlhallaId)).toEqual([1, 2])
  })

  test('an unknown guild is null and makes no further calls', async () => {
    const calls = stubApi(() => ({ status: 200, body: null }))

    expect(await loadGuild(42)).toBeNull()
    expect(calls.map(({ path }) => path)).toEqual(['/clans/42'])
  })

  test('an empty guild never asks for summaries', async () => {
    const calls = stubApi((call) => healthyAnswer(0, call))

    const guild = await loadGuild(42)

    expect(guild?.summaries).toEqual([])
    expect(calls.map(({ path }) => path)).not.toContain('/players/ranked-summaries')
  })

  test('splits more than 250 members into batches', async () => {
    const calls = stubApi((call) => healthyAnswer(251, call))

    const guild = await loadGuild(42)
    const batches = calls.filter(({ path }) => path === '/players/ranked-summaries')

    expect(batches.map(({ body }) => body?.ids.length)).toEqual([250, 1])
    expect(guild?.summaries).toHaveLength(251)
  })

  test('keeps the page when standing fails', async () => {
    stubApi((call) => failingPath(2, '/clans/42/standing', call))

    const guild = await loadGuild(42)

    expect(guild?.standing).toBeNull()
    expect(guild?.summaries).toHaveLength(2)
  })

  test('keeps the roster when summaries fail', async () => {
    stubApi((call) => failingPath(2, '/players/ranked-summaries', call))

    const guild = await loadGuild(42)

    expect(guild?.clan.members).toHaveLength(2)
    expect(guild?.summaries).toEqual([])
    expect(guild?.standing).toEqual({ guildPointsRank: 3, lifetimeXpRank: 9 })
  })

  test('keeps the batches that answered when one fails', async () => {
    stubApi((call) => {
      if (call.path === '/players/ranked-summaries' && call.body?.ids.length === 1) return { status: 503, body: {} }

      return healthyAnswer(251, call)
    })

    expect((await loadGuild(42))?.summaries).toHaveLength(250)
  })

  test('a failed profile throws a message that says what failed', async () => {
    stubApi(() => ({ status: 503, body: {} }))

    await expect(loadGuild(42)).rejects.toThrow('load guild 42: the guild could not be read')
  })

  test('a thrown message does not name internal settings', async () => {
    delete process.env.INTERNAL_API_SECRET
    stubApi((call) => healthyAnswer(2, call))

    const failure = await loadGuild(42).catch((error: Error) => error.message)

    expect(failure).toBe('load guild 42: the guild could not be read')
  })
})
