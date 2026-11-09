import '@tanstack/react-start/server-only'
import { getCookie, getRequestHeader, getRequestIP, setCookie } from '@tanstack/react-start/server'
import { type Visitor, visitorHeaders } from './visitor-headers'

// the old site's name, so a visitor who passed its challenge stays trusted after the switch
const refreshTrustCookie = 'brawltome_refresh_trust'
// as long as the api's token is valid
const refreshTrustMaxAgeSeconds = 24 * 60 * 60

/** The visitor of the request a server function is handling. */
export function currentVisitor(): Visitor {
  const headers = visitorHeaders({
    realIp: getRequestHeader('x-real-ip'),
    cloudflareIp: getRequestHeader('cf-connecting-ip'),
    peerIp: getRequestIP(),
  })

  const keepRefreshTrust = (token: string) =>
    setCookie(refreshTrustCookie, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: refreshTrustMaxAgeSeconds,
    })

  return { headers, refreshTrust: getCookie(refreshTrustCookie), keepRefreshTrust }
}
