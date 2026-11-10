type BrowserPrivacy = {
  doNotTrack: string | null | undefined
  globalPrivacyControl: boolean | undefined
  // set by browsers that scripts drive, like selenium and playwright
  webdriver: boolean | undefined
}

/** Whether the visitor lets us count, and is a person rather than a driven browser. */
export function isMeasuringAllowed({ doNotTrack, globalPrivacyControl, webdriver }: BrowserPrivacy): boolean {
  return doNotTrack !== '1' && globalPrivacyControl !== true && webdriver !== true
}

/** The site a visitor came from, `direct` without one, and nothing for this site's own links. */
export function referrerDomainOf(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return 'direct'

  const withoutWww = (host: string) => host.replace(/^www\./, '')

  try {
    const host = withoutWww(new URL(referrer).hostname)

    return host === withoutWww(ownHost) ? undefined : host
  } catch {
    return undefined
  }
}

/** Whether the tab's page came from a reload, from the navigation timing entries of `performance`. */
export function isReloadNavigation(entries: ReadonlyArray<{ type?: string }>): boolean {
  return entries[0]?.type === 'reload'
}

export function randomVisitId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
