import { afterEach, describe, expect, mock, test } from 'bun:test'
import { isNotFound } from '@tanstack/react-router'
import { parseGuildId } from '../src/components/guild/guild-id'
import { Route as GuildRoute } from '../src/routes/guild.$id'

type RouteHook = (context: { params: { id: string } }) => unknown

function failureOf(hook: unknown, id: string): Promise<unknown> {
  return Promise.resolve()
    .then(() => (hook as RouteHook)({ params: { id } }))
    .catch((failure: unknown) => failure)
}

describe('parseGuildId', () => {
  test('accepts a plain guild id', () => {
    expect(parseGuildId('387803')).toBe(387803)
  })

  test('accepts the largest id the api allows', () => {
    expect(parseGuildId('2147483647')).toBe(2147483647)
  })

  test.each(['abc', '0', '-1', '1.5', '1e3', '0x10', '1.0', '99999999999', '', ' 1', '01', '2147483648'])(
    'rejects %p',
    (value) => {
      expect(parseGuildId(value)).toBeNull()
    },
  )
})

describe('guild route', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test.each(['abc', '0', '99999999999'])('%p is not found without an api call', async (id) => {
    const fetchStub = mock(() => Promise.reject(new Error('no call expected')))

    globalThis.fetch = fetchStub as unknown as typeof fetch

    expect(isNotFound(await failureOf(GuildRoute.options.loader, id))).toBe(true)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})
