import { deviceClass, routeTemplate, viewportBucket } from './labels'
import type { AnalyticsEventInput } from './schema'

const MAX_BATCH = 60
const MAX_T_MS = 86_400_000

export type ClientEnv = {
  enabled: boolean
  doNotTrack: string | null | undefined
  globalPrivacyControl: boolean | undefined
  width: () => number
  pathname: () => string
  now: () => number
  randomHex: (bytes: number) => string
  send: (body: string) => boolean
}

export function createAnalyticsClient(env: ClientEnv) {
  const enabled = env.enabled && env.doNotTrack !== '1' && env.globalPrivacyControl !== true
  const tabId = enabled ? env.randomHex(16) : ''
  const startedAt = enabled ? env.now() : 0
  const queue: Record<string, unknown>[] = []

  function flush(): void {
    if (!enabled || queue.length === 0) return
    const events = queue.splice(0, MAX_BATCH)
    try {
      env.send(JSON.stringify({ events }))
    } catch {
      // Analytics must never break the page; the batch is dropped.
    }
  }

  function track(event: AnalyticsEventInput): void {
    if (!enabled) return
    const width = env.width()
    queue.push({
      ...event,
      tabId,
      route: routeTemplate(env.pathname()),
      device: deviceClass(width),
      viewport: viewportBucket(width),
      t: Math.min(MAX_T_MS, Math.max(0, Math.round(env.now() - startedAt))),
    })
    if (queue.length >= MAX_BATCH) flush()
  }

  return { enabled, track, flush }
}
