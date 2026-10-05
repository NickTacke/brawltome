import { type analyticsDevices, analyticsRoutes } from '@brawltome/telemetry/analytics-labels'

// Zod-free helpers shared by the browser bundle and the server.
export type AnalyticsRoute = (typeof analyticsRoutes)[number]
export type AnalyticsDevice = (typeof analyticsDevices)[number]

const dynamicRoutes: ReadonlyArray<[RegExp, AnalyticsRoute]> = [
  [/^\/player\/\d+$/, '/player/[id]'],
  [/^\/clan\/\d+$/, '/clan/[id]'],
]

export function routeTemplate(pathname: string): AnalyticsRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if ((analyticsRoutes as readonly string[]).includes(path) && !path.includes('[')) return path as AnalyticsRoute
  return dynamicRoutes.find(([pattern]) => pattern.test(path))?.[1] ?? 'other'
}

export const deviceClass = (width: number): AnalyticsDevice =>
  width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop'

export const viewportBucket = (width: number): '<640' | '640-1024' | '1024-1440' | '>1440' =>
  width < 640 ? '<640' : width < 1024 ? '640-1024' : width <= 1440 ? '1024-1440' : '>1440'

export function dataAgeBucket(updatedAt: Date | null, now: number): 'lt_1h' | '1h_12h' | '12h_7d' | 'gt_7d' | 'never' {
  if (!updatedAt) return 'never'
  const age = now - updatedAt.getTime()
  if (age < 3_600_000) return 'lt_1h'
  if (age < 43_200_000) return '1h_12h'
  if (age < 604_800_000) return '12h_7d'
  return 'gt_7d'
}

const stripSecrets = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(api_key|token|secret|password|bearer)([\s:=]+\S+|\S*)/gi, '[redacted]')

export const scrubQuery = (text: string): string => stripSecrets(text).trim().replace(/\s+/g, ' ').slice(0, 64)

export const scrubError = (text: string): string =>
  stripSecrets(text.replace(/https?:\/\/\S+/gi, '[url]'))
    .replace(/\?\S*/g, '')
    .slice(0, 200)
