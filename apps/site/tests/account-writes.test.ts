import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { reorderPinsForVisitor, signOutVisitor, unpinForVisitor } from '../src/server/account-writes'

const apiUrl = 'http://api.test'
const token = 'raw-session-token'
const pinnedAt = '2026-11-01T12:00:00.000Z'
const originalFetch = globalThis.fetch
const originalApiUrl = process.env.INTERNAL_API_URL
const originalSecret = process.env.INTERNAL_API_SECRET

type Call = { path: string; method: string; body: unknown; headers: Headers }

function stubApi(status: number, body: unknown): Call[] {
  const calls: Call[] = []

  const stub = async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace(`${apiUrl}/v1`, '')
    const sentBody = typeof init.body === 'string' ? JSON.parse(init.body) : undefined

    calls.push({ path, method: init.method ?? 'GET', body: sentBody, headers: new Headers(init.headers) })

    return new Response(JSON.stringify(body), { status })
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return calls
}

function writeRequest({ hasSession = true, isSameOrigin = true } = {}) {
  const drops: number[] = []
  const session = { token: hasSession ? token : undefined, drop: () => drops.push(1) }

  return { request: { session, isSameOrigin }, drops }
}

const pins = [
  { brawlhallaId: 8, order: 0, pinnedAt },
  { brawlhallaId: 9, order: 1, pinnedAt },
]

beforeEach(() => {
  process.env.INTERNAL_API_URL = apiUrl
  process.env.INTERNAL_API_SECRET = 'test-secret'
  spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()

  if (originalApiUrl === undefined) delete process.env.INTERNAL_API_URL
  else process.env.INTERNAL_API_URL = originalApiUrl

  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = originalSecret
})

describe('unpinForVisitor', () => {
  test('unpins with the visitor session and answers the new order', async () => {
    const calls = stubApi(200, pins)

    const answer = await unpinForVisitor(7, writeRequest().request)

    expect(answer).toEqual({ kind: 'saved', pinOrder: [8, 9] })
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(['DELETE /account/pinned-players/7'])
    expect(calls[0]?.headers.get('x-visitor-session')).toBe(token)
  })

  test('refuses a request from another site without calling the api', async () => {
    const calls = stubApi(200, pins)

    const answer = await unpinForVisitor(7, writeRequest({ isSameOrigin: false }).request)

    expect(answer).toEqual({ kind: 'failed' })
    expect(calls).toEqual([])
  })

  test('answers signed out without a session', async () => {
    const calls = stubApi(200, pins)

    expect(await unpinForVisitor(7, writeRequest({ hasSession: false }).request)).toEqual({ kind: 'signedOut' })
    expect(calls).toEqual([])
  })

  test('answers failed, without upstream detail, when the api refuses the session', async () => {
    stubApi(401, { detail: 'upstream secret' })

    expect(await unpinForVisitor(7, writeRequest().request)).toEqual({ kind: 'failed' })
  })
})

describe('reorderPinsForVisitor', () => {
  test('sends the whole order with the visitor session', async () => {
    const calls = stubApi(200, pins)

    const answer = await reorderPinsForVisitor([8, 9], writeRequest().request)

    expect(answer).toEqual({ kind: 'saved', pinOrder: [8, 9] })
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/account/pinned-players', body: { brawlhallaIds: [8, 9] } })
    expect(calls[0]?.headers.get('x-visitor-session')).toBe(token)
  })

  test('refuses a request from another site without calling the api', async () => {
    const calls = stubApi(200, pins)

    expect(await reorderPinsForVisitor([8, 9], writeRequest({ isSameOrigin: false }).request)).toEqual({
      kind: 'failed',
    })

    expect(calls).toEqual([])
  })

  test('answers failed when the api refuses the order', async () => {
    stubApi(400, { message: 'Pinned Player order must contain the complete pinned collection' })

    expect(await reorderPinsForVisitor([8], writeRequest().request)).toEqual({ kind: 'failed' })
  })
})

describe('signOutVisitor', () => {
  test('ends the session on the api, then clears the cookie', async () => {
    const calls = stubApi(200, { status: 'signedOut' })
    const { request, drops } = writeRequest()

    expect(await signOutVisitor(request)).toEqual({ kind: 'signedOut' })
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(['POST /account/sign-out'])
    expect(calls[0]?.headers.get('x-visitor-session')).toBe(token)
    expect(drops).toEqual([1])
  })

  // like the old sign out: when the api can't end the session, the cookie stays so the visitor can try again
  test('keeps the cookie when the api fails', async () => {
    stubApi(500, {})
    const { request, drops } = writeRequest()

    expect(await signOutVisitor(request)).toEqual({ kind: 'failed' })
    expect(drops).toEqual([])
  })

  test('refuses a request from another site, leaving the session and cookie alone', async () => {
    const calls = stubApi(200, { status: 'signedOut' })
    const { request, drops } = writeRequest({ isSameOrigin: false })

    expect(await signOutVisitor(request)).toEqual({ kind: 'failed' })
    expect(calls).toEqual([])
    expect(drops).toEqual([])
  })

  test('answers signed out without a session', async () => {
    const calls = stubApi(200, { status: 'signedOut' })

    expect(await signOutVisitor(writeRequest({ hasSession: false }).request)).toEqual({ kind: 'signedOut' })
    expect(calls).toEqual([])
  })
})
