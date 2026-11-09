import { type BoardRegion, defaultRegion, parseRegion } from './home-filters'

export const regionCookieName = 'home_region'

const oneYearSeconds = 60 * 60 * 24 * 365

/** The region in the address if there is one, else the one this visitor picked last time. */
export function pickRegion(requested: BoardRegion | undefined, cookieValue: string | undefined): BoardRegion {
  if (requested) return requested

  return parseRegion(cookieValue) ?? defaultRegion
}

export function regionCookieText(region: BoardRegion): string {
  return `${regionCookieName}=${region}; max-age=${oneYearSeconds}; path=/; samesite=lax`
}

export function rememberRegion(region: BoardRegion) {
  document.cookie = regionCookieText(region)
}
