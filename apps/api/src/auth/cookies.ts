// apps/api/src/auth/cookies.ts
export const SESSION_COOKIE = 'brawltome_session'
export const OAUTH_STATE_COOKIE = 'brawltome_oauth_state'
export const STEAM_STATE_COOKIE = 'brawltome_steam_state'
export const OAUTH_STATE_TTL_SEC = 10 * 60 // 10 minutes

const isProd = process.env.NODE_ENV === 'production'
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN ?? undefined

interface CookieOptions {
  maxAgeSec: number
  includeDomain?: boolean
}

function serialize(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSec}`,
  ]
  if (isProd) parts.push('Secure')
  if (opts.includeDomain && sessionCookieDomain) parts.push(`Domain=${sessionCookieDomain}`)
  return parts.join('; ')
}

export function buildSessionCookie(rawToken: string, maxAgeSec: number): string {
  return serialize(SESSION_COOKIE, rawToken, { maxAgeSec, includeDomain: true })
}

export function clearSessionCookie(): string {
  return serialize(SESSION_COOKIE, '', { maxAgeSec: 0, includeDomain: true })
}

export function buildStateCookie(state: string): string {
  return serialize(OAUTH_STATE_COOKIE, state, { maxAgeSec: OAUTH_STATE_TTL_SEC })
}

export function clearStateCookie(): string {
  return serialize(OAUTH_STATE_COOKIE, '', { maxAgeSec: 0 })
}

export function buildSteamStateCookie(state: string): string {
  return serialize(STEAM_STATE_COOKIE, state, { maxAgeSec: OAUTH_STATE_TTL_SEC })
}

export function clearSteamStateCookie(): string {
  return serialize(STEAM_STATE_COOKIE, '', { maxAgeSec: 0 })
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) {
      try {
        out[k] = decodeURIComponent(v)
      } catch {
        out[k] = v
      }
    }
  }
  return out
}
