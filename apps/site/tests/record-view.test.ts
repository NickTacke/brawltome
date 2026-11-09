import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { recordView } from '../src/server/record-view'
import type { Visitor } from '../src/server/visitor-headers'

const apiUrl = 'http://api.test'
const originalFetch = globalThis.fetch

const originalSettings = {
  INTERNAL_API_URL: process.env.INTERNAL_API_URL,
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
}

type FetchCall = { url: string; init: RequestInit }

function restoreSettings() {
  for (const [name, value] of Object.entries(originalSettings)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function stubApi(answer: () => Response): FetchCall[] {
  const calls: FetchCall[] = []

  const stub = async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })

    return answer()
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return calls
}

const visitor: Visitor = {
  headers: { 'x-visitor-real-ip': '198.51.100.20', 'x-visitor-user-agent': 'Mozilla/5.0' },
  refreshTrust: undefined,
  keepRefreshTrust: () => {},
}

describe('recordView', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_URL = apiUrl
    process.env.INTERNAL_API_SECRET = 'test-secret'
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreSettings()
    mock.restore()
  })

  test('counts the view for the visitor', async () => {
    const calls = stubApi(() => new Response(JSON.stringify({ recorded: true })))

    await recordView(7, visitor)
    const headers = new Headers(calls[0]?.init.headers)

    expect(calls[0]?.url).toBe(`${apiUrl}/v1/players/7/views`)
    expect(calls[0]?.init.method).toBe('POST')
    expect(headers.get('x-visitor-real-ip')).toBe('198.51.100.20')
    expect(headers.get('x-visitor-user-agent')).toBe('Mozilla/5.0')
  })

  test('an api failure never reaches the page', async () => {
    stubApi(() => new Response('upstream detail', { status: 503 }))

    expect(await recordView(7, visitor)).toBeUndefined()
  })

  test('an unreachable api never reaches the page', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('connect failed'))) as unknown as typeof fetch

    expect(await recordView(7, visitor)).toBeUndefined()
  })
})
