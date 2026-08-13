import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const REFRESH_TRUST_COOKIE = 'brawltome_refresh_trust'
export const REFRESH_TRUST_TTL_SECONDS = 24 * 60 * 60

function validateSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) throw new Error('REFRESH_TRUST_COOKIE_SECRET must be at least 32 bytes')
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueRefreshTrust(
  secret: string,
  now = new Date(),
  createNonce: () => string = () => randomBytes(18).toString('base64url'),
): string {
  validateSecret(secret)
  const issuedAt = Math.floor(now.getTime() / 1000)
  const payload = `v1.${issuedAt}.${issuedAt + REFRESH_TRUST_TTL_SECONDS}.${createNonce()}`
  return `${payload}.${signature(payload, secret)}`
}

export function verifyRefreshTrust(token: string | null | undefined, secret: string, now = new Date()): boolean {
  validateSecret(secret)
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== 'v1' || !parts[3]) return false
  const issuedAt = Number(parts[1])
  const expiresAt = Number(parts[2])
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt - issuedAt !== REFRESH_TRUST_TTL_SECONDS
  ) {
    return false
  }
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (issuedAt > nowSeconds || nowSeconds >= expiresAt) return false
  const payload = parts.slice(0, 4).join('.')
  const expected = Buffer.from(signature(payload, secret))
  const provided = Buffer.from(parts[4])
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function buildRefreshTrustCookie(token: string): string {
  return [
    `${REFRESH_TRUST_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${REFRESH_TRUST_TTL_SECONDS}`,
  ].join('; ')
}
