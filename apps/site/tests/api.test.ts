import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { z } from 'zod'
import { postApi, readApi } from '../src/server/api'

const apiUrl = 'http://api.test'
const internalSecret = 'test-internal-secret'
const guildSchema = z.object({ name: z.string() })
const originalFetch = globalThis.fetch
const originalApiUrl = process.env.INTERNAL_API_URL
const originalSecret = process.env.INTERNAL_API_SECRET

type FetchCall = { url: string; init: RequestInit }

function restoreSetting(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]

    return
  }

  process.env[name] = value
}

function stubFetch(answer: (call: FetchCall) => Promise<Response> | Response): FetchCall[] {
  const calls: FetchCall[] = []

  const stub = (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init }

    calls.push(call)

    return Promise.resolve(answer(call))
  }

  globalThis.fetch = stub as typeof fetch

  return calls
}

function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function readFailureMessage(request: Promise<unknown>): Promise<string> {
  const failure = await request.then(
    () => new Error('expected the request to fail'),
    (error: Error) => error,
  )

  return failure.message
}

beforeEach(() => {
  process.env.INTERNAL_API_URL = apiUrl
  process.env.INTERNAL_API_SECRET = internalSecret
})

afterEach(() => {
  mock.restore()
  globalThis.fetch = originalFetch
  restoreSetting('INTERNAL_API_URL', originalApiUrl)
  restoreSetting('INTERNAL_API_SECRET', originalSecret)
})

describe('readApi', () => {
  test('readApi sends the internal secret to /v1', async () => {
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    const guild = await readApi('/clans/42', guildSchema, 'load guild 42')

    expect(guild).toEqual({ name: 'Warriors' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://api.test/v1/clans/42')
    expect(new Headers(calls[0]?.init.headers).get('x-internal-secret')).toBe(internalSecret)
  })

  test('readApi reads a null answer through a nullable schema', async () => {
    stubFetch(() => jsonAnswer(null))

    expect(await readApi('/clans/42', guildSchema.nullable(), 'load guild 42')).toBeNull()
  })

  test('readApi throws naming the description and status on a 503', async () => {
    stubFetch(() => new Response('upstream detail', { status: 503 }))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toBe('load guild 42: api answered 503')
  })

  test('readApi throws on a 404', async () => {
    stubFetch(() => jsonAnswer({ code: 'NOT_FOUND' }, 404))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toBe('load guild 42: api answered 404')
  })

  test("readApi throws when the answer doesn't match the schema", async () => {
    stubFetch(() => jsonAnswer({ name: 12345, private: 'response-body-detail' }))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toContain('load guild 42')
    expect(message).not.toContain('12345')
    expect(message).not.toContain('response-body-detail')
    expect(message).not.toContain(internalSecret)
  })

  test('readApi throws without the body when the answer is not json', async () => {
    stubFetch(() => new Response('<html>response-body-detail</html>'))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toContain('load guild 42')
    expect(message).not.toContain('response-body-detail')
  })

  test('readApi throws when INTERNAL_API_URL is not set', async () => {
    delete process.env.INTERNAL_API_URL
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toBe('load guild 42: INTERNAL_API_URL is not set')
    expect(calls).toHaveLength(0)
  })

  test('readApi throws when INTERNAL_API_SECRET is not set', async () => {
    delete process.env.INTERNAL_API_SECRET
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toBe('load guild 42: INTERNAL_API_SECRET is not set')
    expect(calls).toHaveLength(0)
  })

  test('readApi reads its settings at call time', async () => {
    process.env.INTERNAL_API_URL = 'http://other-api.test'
    process.env.INTERNAL_API_SECRET = 'other-secret'
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    await readApi('/clans/42', guildSchema, 'load guild 42')

    expect(calls[0]?.url).toBe('http://other-api.test/v1/clans/42')
    expect(new Headers(calls[0]?.init.headers).get('x-internal-secret')).toBe('other-secret')
  })

  test('readApi aborts a request after 10 seconds', async () => {
    const controller = new AbortController()
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)

    const calls = stubFetch(
      ({ init }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const request = readApi('/clans/42', guildSchema, 'load guild 42')

    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    const message = await readFailureMessage(request)

    expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(calls[0]?.init.signal).toBe(controller.signal)
    expect(message).toBe('load guild 42: api gave no answer within 10000 ms')
  })

  test('readApi does not follow a redirect, fetch would carry the secret along', async () => {
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    await readApi('/clans/42', guildSchema, 'load guild 42')

    expect(calls[0]?.init.redirect).toBe('error')
  })

  test('readApi keeps the cause of a network failure out of the message', async () => {
    stubFetch(() => Promise.reject(new Error(`connect failed with ${internalSecret}`)))

    const message = await readFailureMessage(readApi('/clans/42', guildSchema, 'load guild 42'))

    expect(message).toBe('load guild 42: could not reach the api')
  })
})

describe('postApi', () => {
  test('postApi sends json with the internal secret', async () => {
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))

    const guild = await postApi('/players/summaries', { ids: [1, 2] }, guildSchema, 'load summaries')
    const headers = new Headers(calls[0]?.init.headers)

    expect(guild).toEqual({ name: 'Warriors' })
    expect(calls[0]?.url).toBe('http://api.test/v1/players/summaries')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe('{"ids":[1,2]}')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-internal-secret')).toBe(internalSecret)
  })

  test('postApi throws naming the description and status on a 500', async () => {
    stubFetch(() => new Response('upstream detail', { status: 500 }))

    const message = await readFailureMessage(postApi('/players/summaries', {}, guildSchema, 'load summaries'))

    expect(message).toBe('load summaries: api answered 500')
  })

  test('postApi sends the headers it is given beside the secret', async () => {
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))
    const visitorHeaders = { 'x-visitor-real-ip': '198.51.100.20' }

    await postApi('/players/7/refresh', {}, guildSchema, 'refresh player 7', { headers: visitorHeaders })
    const headers = new Headers(calls[0]?.init.headers)

    expect(headers.get('x-visitor-real-ip')).toBe('198.51.100.20')
    expect(headers.get('x-internal-secret')).toBe(internalSecret)
  })

  test('postApi never lets a given header replace the secret or the content type', async () => {
    const calls = stubFetch(() => jsonAnswer({ name: 'Warriors' }))
    const forged = { 'x-internal-secret': 'forged', 'content-type': 'text/plain' }

    await postApi('/players/7/refresh', {}, guildSchema, 'refresh player 7', { headers: forged })
    const headers = new Headers(calls[0]?.init.headers)

    expect(headers.get('x-internal-secret')).toBe(internalSecret)
    expect(headers.get('content-type')).toBe('application/json')
  })
})
