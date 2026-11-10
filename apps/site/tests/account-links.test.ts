import { describe, expect, test } from 'bun:test'
import { accountLinks } from '../src/server/account-links'

describe('accountLinks', () => {
  test('points sign-in and steam at the api routes the old site used', () => {
    expect(accountLinks('https://api.brawltome.app')).toEqual({
      signIn: 'https://api.brawltome.app/auth/discord/login',
      verifySteam: 'https://api.brawltome.app/auth/steam/link',
    })
  })

  test('accepts a trailing slash', () => {
    expect(accountLinks('http://localhost:3000/').signIn).toBe('http://localhost:3000/auth/discord/login')
  })

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a url', 'api.brawltome.app'],
    ['another scheme', 'javascript:alert(1)'],
    ['credentials', 'https://user:pass@api.brawltome.app'],
    ['a path', 'https://api.brawltome.app/v1'],
  ])('refuses a PUBLIC_API_URL that is %s', (_, value) => {
    expect(() => accountLinks(value)).toThrow('account links: PUBLIC_API_URL')
  })
})
