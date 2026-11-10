import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { loadAccount } from '../src/server/load-account'
import { loadRailAccount } from '../src/server/load-rail-account'

const apiUrl = 'http://api.test'
const publicApiUrl = 'https://api.brawltome.app'
const token = 'raw-session-token'
const checkedAt = '2026-11-01T12:00:00.000Z'
const originalFetch = globalThis.fetch
const settingNames = ['INTERNAL_API_URL', 'INTERNAL_API_SECRET', 'PUBLIC_API_URL'] as const
const originalSettings = settingNames.map((name) => [name, process.env[name]] as const)

const account = {
  id: '2f1b5ca7-0c73-4ac8-93ea-a22a663cb295',
  displayName: 'Ada',
  avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
  createdAt: '2025-03-12T10:00:00.000Z',
}

const signedIn = { status: 'signedIn', account, sessionExpiresAt: '2026-11-20T12:00:00.000Z' }

const pin = (brawlhallaId: number, order: number) => ({ brawlhallaId, order, pinnedAt: checkedAt })

const attempt = (status: string) => ({
  id: '5f689990-dc60-4d70-bd1c-7b49b89786b7',
  status,
  startedAt: checkedAt,
  completedAt: status === 'pending' ? null : checkedAt,
  player: null,
})

const unverified = { primaryPlayer: null, attempts: [] }

const verified = {
  primaryPlayer: { brawlhallaId: 7, name: 'Seven', verifiedAt: checkedAt },
  attempts: [{ ...attempt('verified'), player: { brawlhallaId: 7, name: 'Seven' } }],
}

function ranked(brawlhallaId: number, rating: number) {
  const oneVsOne = { rating, peakRating: rating + 50, tier: 'Diamond', wins: 10, games: 20, region: 'EU' }

  return {
    brawlhallaId,
    checkedAt,
    lastSuccessAt: checkedAt,
    freshness: 'fresh',
    freshForSeconds: 3600,
    sparsePulse: null,
    snapshot: {
      oneVsOne: { ...oneVsOne, globalRank: null, regionRank: null },
      rankedLegends: [],
      mainLegend: { legendId: 3, legendNameKey: 'bodvar', source: 'current-season' },
      fixedTeams: [],
      soloQueue: [],
      ratingHistory: [],
      observedRatingDirection: null,
    },
  }
}

const reference = (brawlhallaId: number, name: string) => ({ brawlhallaId, name, aliases: [] })

type Answer = { status: number; body: unknown }
type Call = { path: string; method: string; headers: Headers }

function healthyAnswers(): Record<string, Answer> {
  return {
    'GET /account': { status: 200, body: signedIn },
    'GET /account/pinned-players': { status: 200, body: [pin(9, 0), pin(7, 1), pin(8, 2)] },
    'GET /account/primary-player': { status: 200, body: verified },
    'GET /players/7/reference': { status: 200, body: reference(7, 'Seven') },
    'GET /players/7/ranked': { status: 200, body: ranked(7, 2000) },
    'GET /players/8/reference': { status: 200, body: reference(8, 'Eight') },
    'GET /players/8/ranked': { status: 200, body: null },
    'GET /players/9/reference': { status: 200, body: reference(9, 'Nine') },
    'GET /players/9/ranked': { status: 200, body: ranked(9, 1500) },
  }
}

function stubApi(answers: Record<string, Answer>): Call[] {
  const calls: Call[] = []

  const stub = async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace(`${apiUrl}/v1`, '')
    const method = init.method ?? 'GET'
    const answer = answers[`${method} ${path}`] ?? { status: 404, body: {} }

    calls.push({ path, method, headers: new Headers(init.headers) })

    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return calls
}

function sessionWith(sessionToken: string | undefined) {
  const keptUntil: Date[] = []

  return { session: { token: sessionToken, keepUntil: (until: Date) => keptUntil.push(until) }, keptUntil }
}

async function failureOf(work: Promise<unknown>): Promise<Error> {
  return work.then(
    () => new Error('expected the load to fail'),
    (error: Error) => error,
  )
}

beforeEach(() => {
  process.env.INTERNAL_API_URL = apiUrl
  process.env.INTERNAL_API_SECRET = 'test-secret'
  process.env.PUBLIC_API_URL = publicApiUrl
  spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()

  for (const [name, value] of originalSettings) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('loadAccount for a visitor without a session', () => {
  test('is signed out without asking the api', async () => {
    const calls = stubApi(healthyAnswers())

    const page = await loadAccount(sessionWith(undefined).session)

    expect(page).toEqual({ kind: 'signedOut', signInUrl: `${publicApiUrl}/auth/discord/login` })
    expect(calls).toEqual([])
  })
})

describe('loadAccount for a session the api rejects', () => {
  test('is signed out after asking only for the account', async () => {
    const calls = stubApi({ ...healthyAnswers(), 'GET /account': { status: 200, body: { status: 'anonymous' } } })

    const page = await loadAccount(sessionWith('expired-token').session)

    expect(page.kind).toBe('signedOut')
    expect(calls.map(({ path }) => path)).toEqual(['/account'])
  })
})

describe('loadAccount for a signed in visitor', () => {
  test('shows the account and the pins in their order, with the verified account apart', async () => {
    stubApi(healthyAnswers())

    const page = await loadAccount(sessionWith(token).session)

    if (page.kind !== 'signedIn') throw new Error('expected a signed in page')

    expect(page.account).toEqual({ displayName: 'Ada', avatarUrl: account.avatarUrl, createdAt: account.createdAt })
    expect(page.pins.map(({ brawlhallaId }) => brawlhallaId)).toEqual([9, 8])
    expect(page.pinOrder).toEqual([9, 7, 8])
    expect(page.verifySteamUrl).toBe(`${publicApiUrl}/auth/steam/link`)
  })

  test('fills each row from the player reads', async () => {
    stubApi(healthyAnswers())

    const page = await loadAccount(sessionWith(token).session)

    if (page.kind !== 'signedIn') throw new Error('expected a signed in page')

    expect(page.pins[0]).toEqual({
      brawlhallaId: 9,
      name: 'Nine',
      legendNameKey: 'bodvar',
      region: 'EU',
      tier: 'Diamond',
      rating: 1500,
      peakRating: 1550,
      wins: 10,
      games: 20,
    })

    expect(page.pins[1]).toMatchObject({ brawlhallaId: 8, name: 'Eight', tier: null, rating: null, games: 0 })
  })

  test('sends the session to the account reads and never to the player reads', async () => {
    const calls = stubApi(healthyAnswers())

    await loadAccount(sessionWith(token).session)

    const accountCalls = calls.filter(({ path }) => path.startsWith('/account'))
    const playerCalls = calls.filter(({ path }) => path.startsWith('/players'))

    expect(accountCalls).toHaveLength(3)
    expect(accountCalls.every(({ headers }) => headers.get('x-visitor-session') === token)).toBe(true)
    expect(playerCalls.some(({ headers }) => headers.has('x-visitor-session'))).toBe(false)
  })

  test('keeps the cookie until the end of the session on every load', async () => {
    const { session, keptUntil } = sessionWith(token)

    stubApi(healthyAnswers())
    await loadAccount(session)

    expect(keptUntil).toEqual([new Date('2026-11-20T12:00:00.000Z')])
  })

  test('still shows a pin whose player reads fail', async () => {
    stubApi({ ...healthyAnswers(), 'GET /players/9/reference': { status: 503, body: {} } })

    const page = await loadAccount(sessionWith(token).session)

    if (page.kind !== 'signedIn') throw new Error('expected a signed in page')

    expect(page.pins[0]).toMatchObject({ brawlhallaId: 9, name: null })
  })
})

describe('loadAccount verification', () => {
  test('shows the verified account with its facts', async () => {
    stubApi(healthyAnswers())

    const page = await loadAccount(sessionWith(token).session)

    if (page.kind !== 'signedIn') throw new Error('expected a signed in page')

    expect(page.verification).toMatchObject({ status: 'verified', player: { brawlhallaId: 7, rating: 2000 } })
  })

  test.each([
    ['unverified', unverified],
    ['pending', { primaryPlayer: null, attempts: [attempt('pending')] }],
    ['failed', { primaryPlayer: null, attempts: [attempt('failed')] }],
    ['conflict', { primaryPlayer: null, attempts: [attempt('conflict')] }],
  ])('shows %s', async (status, state) => {
    stubApi({ ...healthyAnswers(), 'GET /account/primary-player': { status: 200, body: state } })

    const page = await loadAccount(sessionWith(token).session)

    if (page.kind !== 'signedIn') throw new Error('expected a signed in page')

    expect(page.verification).toEqual({ status } as never)
    expect(page.pins.map(({ brawlhallaId }) => brawlhallaId)).toEqual([9, 7, 8])
  })
})

describe('loadAccount failures', () => {
  test.each(['GET /account', 'GET /account/pinned-players', 'GET /account/primary-player'])(
    'throws without upstream detail when %s fails',
    async (call) => {
      stubApi({ ...healthyAnswers(), [call]: { status: 503, body: { detail: 'upstream secret' } } })

      const failure = await failureOf(loadAccount(sessionWith(token).session))

      expect(failure.message).toBe('load account: the account could not be read')
    },
  )

  test('throws without the setting value when PUBLIC_API_URL is wrong', async () => {
    process.env.PUBLIC_API_URL = 'not a url'
    stubApi(healthyAnswers())

    const failure = await failureOf(loadAccount(sessionWith(undefined).session))

    expect(failure.message).toBe('load account: the account could not be read')
  })
})

describe('loadRailAccount', () => {
  test('is signed out without asking the api when there is no session cookie', async () => {
    const calls = stubApi(healthyAnswers())

    expect(await loadRailAccount(sessionWith(undefined).session)).toEqual({ kind: 'signedOut' })
    expect(calls).toEqual([])
  })

  test('is signed out for a session the api rejects', async () => {
    stubApi({ ...healthyAnswers(), 'GET /account': { status: 200, body: { status: 'anonymous' } } })

    expect(await loadRailAccount(sessionWith('expired-token').session)).toEqual({ kind: 'signedOut' })
  })

  test('has the avatar, the verified account and the other pins in their order', async () => {
    stubApi(healthyAnswers())

    const rail = await loadRailAccount(sessionWith(token).session)

    expect(rail).toEqual({
      kind: 'signedIn',
      displayName: 'Ada',
      avatarUrl: account.avatarUrl,
      verifiedPlayer: { brawlhallaId: 7, name: 'Seven', legendNameKey: 'bodvar' },
      pins: [
        { brawlhallaId: 9, name: 'Nine', legendNameKey: 'bodvar' },
        { brawlhallaId: 8, name: 'Eight', legendNameKey: null },
      ],
      pinLimit: 20,
    })
  })

  test('keeps the cookie until the end of the session', async () => {
    stubApi(healthyAnswers())

    const { session, keptUntil } = sessionWith(token)

    await loadRailAccount(session)

    expect(keptUntil).toEqual([new Date(signedIn.sessionExpiresAt)])
  })

  test('fails without the detail when the account read fails', async () => {
    stubApi({ ...healthyAnswers(), 'GET /account': { status: 500, body: {} } })

    const error = await failureOf(loadRailAccount(sessionWith(token).session))

    expect(error.message).toBe('load rail account: the account could not be read')
  })
})
