import { isMeasuringAllowed, randomVisitId } from './browser-visit'

// one per tab and only in its memory, so a visit id is never stored on the device; null when we may not count
let tabVisitId: string | null | undefined

function createTabVisitId(): string | null {
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean }

  const privacy = {
    doNotTrack: browser.doNotTrack,
    globalPrivacyControl: browser.globalPrivacyControl,
    webdriver: browser.webdriver,
  }

  return isMeasuringAllowed(privacy) ? randomVisitId() : null
}

/** The id everything this tab counts carries, or null for a visitor we may not count. Only for the browser. */
export function tabVisitIdOrNull(): string | null {
  if (tabVisitId !== undefined) return tabVisitId

  try {
    tabVisitId = createTabVisitId()
  } catch {
    tabVisitId = null
  }

  return tabVisitId
}
