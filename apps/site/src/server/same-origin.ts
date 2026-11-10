type RequestSource = {
  // the Sec-Fetch-Site header, which every current browser sends
  fetchSite: string | undefined
  origin: string | undefined
  host: string | undefined
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

/**
 * Whether a write came from a page on this site, the check the old site made with the Origin header before signing
 * out. Same-site isn't enough: a page on another subdomain would send the session cookie along.
 */
export function isSameOriginRequest({ fetchSite, origin, host }: RequestSource): boolean {
  if (fetchSite !== undefined) return fetchSite === 'same-origin'

  if (!origin || !host) return false

  return hostOf(origin) === host
}
