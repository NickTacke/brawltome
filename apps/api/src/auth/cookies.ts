export const SESSION_COOKIE = 'brawltome_session'
export const OAUTH_STATE_COOKIE = 'brawltome_oauth_state'
export const STEAM_STATE_COOKIE = 'brawltome_steam_state'
export const SESSION_COOKIE_TTL_SEC = 30 * 24 * 60 * 60
export const OAUTH_STATE_TTL_SEC = 10 * 60

const isProd = process.env.NODE_ENV === 'production'

// empty or unset keeps the session cookie on the api's own host
export const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN || undefined

interface CookieOptions {
  maxAgeSec: number
  domain?: string
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

  if (opts.domain) parts.push(`Domain=${opts.domain}`)

  return parts.join('; ')
}

export function buildSessionCookie(rawToken: string, maxAgeSec: number): string {
  return serialize(SESSION_COOKIE, rawToken, { maxAgeSec, domain: sessionCookieDomain })
}

/** Clears the session cookie, and the host-only copy from before SESSION_COOKIE_DOMAIN was set. */
export function clearSessionCookies(domain: string | undefined): string[] {
  const clearHostOnly = serialize(SESSION_COOKIE, '', { maxAgeSec: 0 })

  if (!domain) return [clearHostOnly]

  return [clearHostOnly, serialize(SESSION_COOKIE, '', { maxAgeSec: 0, domain })]
}

/**
 * Sets a session the visitor already holds again. Once SESSION_COOKIE_DOMAIN is set, this moves a host-only cookie
 * from before onto the domain, where the site can read it too.
 */
export function reissueSessionCookies(rawToken: string, maxAgeSec: number, domain: string | undefined): string[] {
  const sessionCookie = serialize(SESSION_COOKIE, rawToken, { maxAgeSec, domain })

  if (!domain) return [sessionCookie]

  // the host-only copy is a separate cookie, and left in place it would still reach this host beside the new one
  const clearHostOnly = serialize(SESSION_COOKIE, '', { maxAgeSec: 0 })

  return [clearHostOnly, sessionCookie]
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
