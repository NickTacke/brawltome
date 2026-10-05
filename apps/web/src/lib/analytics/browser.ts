import { createAnalyticsClient } from './client'
import type { AnalyticsEventInput } from './schema'

type BeaconNavigator = { sendBeacon?: (url: string, data: Blob) => boolean }
type FetchLike = (url: string, init: RequestInit) => Promise<unknown>

/** Sends via sendBeacon, falling back to a keepalive fetch. Never throws. */
export function sendPayload(body: string, nav: BeaconNavigator, fetchFn: FetchLike | undefined): boolean {
  try {
    if (nav.sendBeacon?.('/api/a', new Blob([body], { type: 'application/json' })) === true) return true
  } catch {
    // fall through to fetch
  }
  try {
    const pending = fetchFn?.('/api/a', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    })
    pending?.catch(() => {})
    return pending !== undefined
  } catch {
    return false
  }
}

export function referrerDomain(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return 'direct'
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '')
    return host === ownHost.replace(/^www\./, '') ? undefined : host
  } catch {
    return undefined
  }
}

let client: ReturnType<typeof createAnalyticsClient> | null = null

function instance() {
  if (typeof window === 'undefined') return null
  client ??= createAnalyticsClient({
    enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
    width: () => window.innerWidth,
    pathname: () => window.location.pathname,
    now: () => performance.now(),
    randomHex: (bytes) =>
      Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, '0')).join(
        '',
      ),
    send: (body) => sendPayload(body, navigator, (url, init) => fetch(url, init)),
  })
  return client
}

export const track = (event: AnalyticsEventInput): void => {
  try {
    instance()?.track(event)
  } catch {
    // Analytics must never break the page.
  }
}
export const flushAnalytics = (): void => {
  try {
    instance()?.flush()
  } catch {
    // Analytics must never break the page.
  }
}
