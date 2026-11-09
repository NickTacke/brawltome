import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { requestRefresh } from '../src/server/request-refresh'
import type { Visitor } from '../src/server/visitor-headers'

const apiUrl = 'http://api.test'
const originalFetch = globalThis.fetch

const originalSettings = {
  INTERNAL_API_URL: process.env.INTERNAL_API_URL,
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
}

type FetchCall = { url: string; init: RequestInit }

// assigning undefined would store the text "undefined"
function restoreSettings() {
  for (const [name, value] of Object.entries(originalSettings)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function stubApi(status: number, body: unknown): FetchCall[] {
  const calls: FetchCall[] = []

  const stub = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })

    return new Response(JSON.stringify(body), { status })
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return calls
}

function createVisitor(refreshTrust?: string): Visitor & { kept: string[] } {
  const kept: string[] = []

  return {
    headers: { 'x-visitor-real-ip': '198.51.100.20' },
    refreshTrust,
    keepRefreshTrust: (token) => kept.push(token),
    kept,
  }
}

const operationId = '2ef5a585-e8b9-46df-8f95-53d03af42d11'
const accepted = { outcome: 'accepted', operationId, retry: { kind: 'poll', afterSeconds: 2 } }

describe('requestRefresh', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_URL = apiUrl
    process.env.INTERNAL_API_SECRET = 'test-secret'
    process.env.TURNSTILE_SITE_KEY = 'site-key'
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreSettings()
    mock.restore()
  })

  test('asks the api on behalf of the visitor', async () => {
    const calls = stubApi(200, { refresh: accepted, refreshTrust: null })

    await requestRefresh('players', { id: 7, turnstileToken: 'answer' }, createVisitor('trust'))
    const headers = new Headers(calls[0]?.init.headers)

    expect(calls[0]?.url).toBe(`${apiUrl}/v1/players/7/refresh`)
    expect(calls[0]?.init.body).toBe('{"turnstileToken":"answer","refreshTrust":"trust"}')
    expect(headers.get('x-visitor-real-ip')).toBe('198.51.100.20')
  })

  test('a started refresh tells the page when to look again', async () => {
    stubApi(200, { refresh: accepted, refreshTrust: null })

    expect(await requestRefresh('clans', { id: 77 }, createVisitor())).toEqual({
      kind: 'refreshing',
      pollAfterSeconds: 2,
    })
  })

  test('fresh data needs nothing', async () => {
    stubApi(200, { refresh: { outcome: 'notNeeded', retry: { kind: 'none' } }, refreshTrust: null })

    expect(await requestRefresh('players', { id: 7 }, createVisitor())).toEqual({ kind: 'fresh' })
  })

  test('a challenge comes with the public site key', async () => {
    stubApi(200, { refresh: { outcome: 'verificationRequired', retry: { kind: 'verify' } }, refreshTrust: null })

    expect(await requestRefresh('players', { id: 7 }, createVisitor())).toEqual({ kind: 'verify', siteKey: 'site-key' })
  })

  test('an admission refusal comes with the wait', async () => {
    stubApi(200, {
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 900 } },
      refreshTrust: null,
    })

    expect(await requestRefresh('players', { id: 7 }, createVisitor())).toEqual({
      kind: 'refused',
      retryAfterSeconds: 900,
    })
  })

  test('keeps the trust the api grants', async () => {
    stubApi(200, { refresh: accepted, refreshTrust: 'granted-token' })
    const visitor = createVisitor()

    await requestRefresh('players', { id: 7, turnstileToken: 'answer' }, visitor)

    expect(visitor.kept).toEqual(['granted-token'])
  })

  test('an api failure answers unavailable without the upstream detail', async () => {
    stubApi(503, { detail: 'upstream detail' })

    const answer = await requestRefresh('players', { id: 7 }, createVisitor())

    expect(answer).toEqual({ kind: 'unavailable', retryAfterSeconds: 30 })
    expect(JSON.stringify(answer)).not.toContain('upstream detail')
  })
})
