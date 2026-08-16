import { createHmac, timingSafeEqual } from 'node:crypto'

export const matchesPreviewCookieName = 'matches_preview'

function previewToken(): string | undefined {
  const token = process.env.MATCHES_PREVIEW_TOKEN
  return token && Buffer.byteLength(token) >= 32 ? token : undefined
}

function previewCookieValue(): string | undefined {
  const token = previewToken()
  if (!token) return undefined
  return createHmac('sha256', token).update('matches-preview-cookie-v1').digest('base64url')
}

function equal(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export function matchesPreviewInviteAuthorized(token: string | null): boolean {
  return equal(token ?? undefined, previewToken())
}

export function matchesPreviewCookieValue(): string | undefined {
  return previewCookieValue()
}

export function matchesPreviewCookieAuthorized(cookie: string | undefined): boolean {
  return equal(cookie, previewCookieValue())
}
