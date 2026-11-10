import '@tanstack/react-start/server-only'
import { getCookie, setCookie } from '@tanstack/react-start/server'

// the api's cookie: the api sets it at sign-in, the site only reads it, renews it and clears it at sign-out
export const sessionCookieName = 'brawltome_session'

type SessionCookieSettings = { domain: string | undefined; isProduction: boolean }

type SessionCookieOptions = {
  path: '/'
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  domain?: string
}

/** The attributes the api gives the cookie, from the same SESSION_COOKIE_DOMAIN and NODE_ENV settings. */
export function sessionCookieOptions({ domain, isProduction }: SessionCookieSettings): SessionCookieOptions {
  const options: SessionCookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', secure: isProduction }

  if (domain) options.domain = domain

  return options
}

function currentOptions(): SessionCookieOptions {
  const settings = { domain: process.env.SESSION_COOKIE_DOMAIN, isProduction: process.env.NODE_ENV === 'production' }

  return sessionCookieOptions(settings)
}

/** The visitor's session as the site's server sees it. It never leaves the server: the api gets it in a header. */
export type VisitorSession = {
  token: string | undefined
  keepUntil: (expiresAt: Date) => void
  drop: () => void
}

export function currentSession(): VisitorSession {
  const token = getCookie(sessionCookieName) || undefined

  const keepUntil = (expiresAt: Date) => {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))

    if (token) setCookie(sessionCookieName, token, { ...currentOptions(), maxAge })
  }

  const drop = () => setCookie(sessionCookieName, '', { ...currentOptions(), maxAge: 0 })

  return { token, keepUntil, drop }
}
