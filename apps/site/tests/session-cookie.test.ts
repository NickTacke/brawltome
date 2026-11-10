import { describe, expect, test } from 'bun:test'
import { sessionCookieName, sessionCookieOptions } from '../src/server/session-cookie'

// the api sets this cookie (apps/api/src/auth/cookies.ts); the site must write the very same one, or the browser
// would keep two cookies of the same name
describe('the session cookie the site writes', () => {
  test('has the api name', () => {
    expect(sessionCookieName).toBe('brawltome_session')
  })

  test('matches the api attributes in production', () => {
    const options = sessionCookieOptions({ domain: 'brawltome.app', isProduction: true })

    expect(options).toEqual({ path: '/', httpOnly: true, sameSite: 'lax', secure: true, domain: 'brawltome.app' })
  })

  test('is host-only without a configured domain, like the api', () => {
    const options = sessionCookieOptions({ domain: undefined, isProduction: false })

    expect(options).toEqual({ path: '/', httpOnly: true, sameSite: 'lax', secure: false })
  })

  test('treats an empty domain setting as none', () => {
    expect(sessionCookieOptions({ domain: '', isProduction: true })).not.toHaveProperty('domain')
  })
})
