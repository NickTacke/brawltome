import { describe, expect, test } from 'bun:test'
import { isSameOriginRequest } from '../src/server/same-origin'

const host = 'brawltome.app'

describe('isSameOriginRequest', () => {
  test('allows a request the browser marks same-origin', () => {
    expect(isSameOriginRequest({ fetchSite: 'same-origin', origin: 'https://brawltome.app', host })).toBe(true)
  })

  test.each(['cross-site', 'same-site', 'none'])('refuses a request the browser marks %s', (fetchSite) => {
    expect(isSameOriginRequest({ fetchSite, origin: 'https://brawltome.app', host })).toBe(false)
  })

  // a page on another subdomain is same-site, so the cookie would go along; only this host may write
  test('refuses a sibling subdomain', () => {
    expect(isSameOriginRequest({ fetchSite: 'same-site', origin: 'https://evil.brawltome.app', host })).toBe(false)
  })

  test('falls back to the origin when the browser sends no fetch site', () => {
    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'https://brawltome.app', host })).toBe(true)
    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'https://evil.example', host })).toBe(false)
  })

  test('compares the port as part of the host', () => {
    const localHost = 'localhost:3200'

    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'http://localhost:3200', host: localHost })).toBe(true)
    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'http://localhost:3001', host: localHost })).toBe(false)
  })

  test('refuses a request that says nothing about where it came from', () => {
    expect(isSameOriginRequest({ fetchSite: undefined, origin: undefined, host })).toBe(false)
  })

  test('refuses an origin it cannot read', () => {
    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'null', host })).toBe(false)
  })

  test('refuses when the host is unknown', () => {
    expect(isSameOriginRequest({ fetchSite: undefined, origin: 'https://brawltome.app', host: undefined })).toBe(false)
  })
})
