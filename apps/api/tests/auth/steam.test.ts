import { describe, expect, test } from 'bun:test'
import { buildSteamLoginUrl, extractSteamId } from '../../src/auth/steam'

describe('buildSteamLoginUrl', () => {
  test('builds valid Steam OpenID URL', () => {
    const url = buildSteamLoginUrl({
      returnUrl: 'http://localhost:3000/auth/steam/callback',
      realm: 'http://localhost:3000',
    })
    expect(url).toContain('https://steamcommunity.com/openid/login')
    expect(url).toContain('openid.mode=checkid_setup')
    expect(url).toContain(encodeURIComponent('http://localhost:3000/auth/steam/callback'))
  })
})

describe('extractSteamId', () => {
  test('extracts Steam ID from claimed_id', () => {
    const id = extractSteamId('https://steamcommunity.com/openid/id/76561198000000000')
    expect(id).toBe('76561198000000000')
  })

  test('returns null for invalid claimed_id', () => {
    expect(extractSteamId('https://example.com/fake')).toBeNull()
    expect(extractSteamId('')).toBeNull()
  })
})
