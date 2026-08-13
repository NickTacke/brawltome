import { describe, expect, test } from 'bun:test'
import { resolveServerApiUrl } from '../../src/lib/api-url'

describe('web API URL resolution', () => {
  test('prefers the internal runtime URL for server-to-server calls', () => {
    expect(
      resolveServerApiUrl({
        INTERNAL_API_URL: 'http://api:3000',
        NEXT_PUBLIC_API_URL: 'https://v3-api.brawltome.app',
      }),
    ).toBe('http://api:3000')
  })

  test('falls back to the browser URL outside the internal topology', () => {
    expect(resolveServerApiUrl({ NEXT_PUBLIC_API_URL: 'https://api.brawltome.app' })).toBe('https://api.brawltome.app')
  })

  test('rejects credentials and non-http origins', () => {
    expect(() => resolveServerApiUrl({ INTERNAL_API_URL: 'postgres://api' })).toThrow('HTTP URL')
    expect(() => resolveServerApiUrl({ INTERNAL_API_URL: 'https://user:password@api.example' })).toThrow('credentials')
  })
})
