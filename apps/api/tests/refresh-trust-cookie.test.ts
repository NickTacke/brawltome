import { describe, expect, test } from 'bun:test'
import {
  REFRESH_TRUST_COOKIE,
  REFRESH_TRUST_TTL_SECONDS,
  buildRefreshTrustCookie,
  issueRefreshTrust,
  verifyRefreshTrust,
} from '../src/auth/refresh-trust-cookie'

const secret = 'refresh-trust-cookie-test-secret-at-least-32-bytes'
const issuedAt = new Date('2026-03-01T12:00:00Z')

describe('anonymous refresh trust cookie', () => {
  test('is signed, Secure, HttpOnly, exact 24 hours, and fixed', () => {
    const token = issueRefreshTrust(secret, issuedAt, () => 'fixed-nonce')
    expect(verifyRefreshTrust(token, secret, new Date('2026-03-02T11:59:59Z'))).toBe(true)
    expect(verifyRefreshTrust(token, secret, new Date('2026-03-02T12:00:00Z'))).toBe(false)
    expect(buildRefreshTrustCookie(token)).toBe(
      `${REFRESH_TRUST_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_TRUST_TTL_SECONDS}`,
    )

    const parts = token.split('.')
    expect(parts[0]).toBe('v1')
    expect(Number(parts[2]) - Number(parts[1])).toBe(REFRESH_TRUST_TTL_SECONDS)
  })

  test('rejects tampering, malformed payloads, wrong secrets, and short configuration secrets', () => {
    const token = issueRefreshTrust(secret, issuedAt, () => 'fixed-nonce')
    expect(verifyRefreshTrust(`${token.slice(0, -1)}x`, secret, issuedAt)).toBe(false)
    expect(verifyRefreshTrust(token, `${secret}-different`, issuedAt)).toBe(false)
    expect(verifyRefreshTrust('malformed', secret, issuedAt)).toBe(false)
    expect(() => issueRefreshTrust('too-short', issuedAt)).toThrow('at least 32 bytes')
    expect(() => verifyRefreshTrust(token, 'too-short', issuedAt)).toThrow('at least 32 bytes')
  })
})
