import { createAnalyticsClient } from './client'
import type { AnalyticsEventInput } from './schema'

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
    send: (body) => navigator.sendBeacon?.('/api/a', new Blob([body], { type: 'application/json' })) ?? false,
  })
  return client
}

export const track = (event: AnalyticsEventInput): void => {
  instance()?.track(event)
}
export const flushAnalytics = (): void => {
  instance()?.flush()
}
