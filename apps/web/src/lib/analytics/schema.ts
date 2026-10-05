import { analyticsDevices, analyticsFeatures, analyticsRoutes } from '@brawltome/telemetry/analytics-labels'
import { z } from 'zod'

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

const stripSensitive = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\?\S*/g, '')
    .replace(/(api_key|token|secret|password|bearer)([\s:=]+\S+|\S*)/gi, '[redacted]')

export const scrubQuery = (text: string): string => stripSensitive(text).trim().replace(/\s+/g, ' ').slice(0, 64)

export const scrubError = (text: string): string => stripSensitive(text).slice(0, 200)

const common = {
  tabId: z.string().regex(/^[0-9a-f]{32}$/),
  route: z.enum(analyticsRoutes),
  device: z.enum(analyticsDevices),
  viewport: z.enum(['<640', '640-1024', '1024-1440', '>1440']),
  t: z.number().int().min(0).max(86_400_000),
}
const ms = z.number().int().min(0).max(600_000)
const source = z.enum(['bar', 'palette'])

export const analyticsEventSchema = z.discriminatedUnion('name', [
  z.object({ ...common, name: z.literal('pageview'), referrerDomain: z.string().max(253).optional() }).strict(),
  z
    .object({
      ...common,
      name: z.literal('search.performed'),
      source,
      query: z.string().max(200),
      results: z.number().int().min(0).max(100),
      aliasResults: z.number().int().min(0).max(100),
      latencyMs: ms,
    })
    .strict(),
  z.object({ ...common, name: z.literal('search.failed'), source, latencyMs: ms }).strict(),
  z
    .object({
      ...common,
      name: z.literal('search.selected'),
      source,
      position: z.number().int().min(0).max(100),
      viaAlias: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('profile.viewed'),
      dataAge: z.enum(['lt_1h', '1h_12h', '12h_7d', 'gt_7d', 'never']),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('refresh.state'),
      state: z.enum(['looking_up', 'busy', 'rate_limited', 'gave_up', 'timed_out', 'still_updating', 'verify_failed']),
    })
    .strict(),
  z
    .object({ ...common, name: z.literal('refresh.completed'), waitMs: ms, retries: z.number().int().min(0).max(10) })
    .strict(),
  z.object({ ...common, name: z.literal('refresh.abandoned'), waitedMs: ms }).strict(),
  z
    .object({
      ...common,
      name: z.literal('vitals'),
      metric: z.enum(['LCP', 'INP', 'CLS', 'TTFB']),
      value: z.number().min(0).max(600_000),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('error.client'),
      kind: z.enum(['render', 'unhandled', 'rejection']),
      message: z.string().max(1000),
    })
    .strict(),
  z
    .object({ ...common, name: z.literal('trpc.failed'), procedure: z.string().max(80), code: z.string().max(40) })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('deadend'),
      kind: z.enum(['404', 'player_not_found', 'clan_not_found', 'try_again_clicked']),
    })
    .strict(),
  z.object({ ...common, name: z.literal('feature.used'), feature: z.enum(analyticsFeatures) }).strict(),
])

export const analyticsBatchSchema = z.object({ events: z.array(analyticsEventSchema).min(1).max(60) }).strict()
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>
export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>
export type AnalyticsEventInput = AnalyticsEvent extends infer E
  ? E extends AnalyticsEvent
    ? Omit<E, keyof typeof common>
    : never
  : never
