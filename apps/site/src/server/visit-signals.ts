/** What a request to count a page view says about where it came from. */
export type VisitSignals = {
  isSameOrigin: boolean
  userAgent: string | undefined
  acceptLanguage: string | undefined
  doNotTrack: string | undefined
  // the Sec-GPC header
  globalPrivacyControl: string | undefined
}

// every current browser names itself this way first, scripts and http libraries mostly don't
const browserUserAgentPrefix = 'Mozilla/5.0 '

/**
 * Whether a page view came from a browser showing a page of this site, to a visitor who lets us count. Known bots
 * that pass this are left out by the api, by their user agent.
 */
export function isCountableVisit(signals: VisitSignals): boolean {
  if (signals.doNotTrack === '1' || signals.globalPrivacyControl === '1') return false

  if (!signals.isSameOrigin) return false

  if (!signals.userAgent?.startsWith(browserUserAgentPrefix)) return false

  return Boolean(signals.acceptLanguage?.trim())
}
