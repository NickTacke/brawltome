import { type analyticsDevices, analyticsRoutes } from '@brawltome/telemetry/analytics-labels'

type AnalyticsRoute = (typeof analyticsRoutes)[number]
type AnalyticsDevice = (typeof analyticsDevices)[number]
type ViewportBucket = '<640' | '640-1024' | '1024-1440' | '>1440'

const routesWithId: ReadonlyArray<[RegExp, AnalyticsRoute]> = [
  [/^\/player\/\d+$/, '/player/[id]'],
  [/^\/guild\/\d+$/, '/guild/[id]'],
  [/^\/clan\/\d+$/, '/clan/[id]'],
]

/** The route a path belongs to, so player ids never become metric labels. */
export function routeOf(path: string): AnalyticsRoute {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const isFixedRoute = (analyticsRoutes as readonly string[]).includes(trimmed) && !trimmed.includes('[')

  if (isFixedRoute) return trimmed as AnalyticsRoute

  const match = routesWithId.find(([pattern]) => pattern.test(trimmed))

  return match ? match[1] : 'other'
}

export function deviceOf(viewportWidth: number): AnalyticsDevice {
  if (viewportWidth < 640) return 'mobile'

  if (viewportWidth < 1024) return 'tablet'

  return 'desktop'
}

export function viewportBucketOf(viewportWidth: number): ViewportBucket {
  if (viewportWidth < 640) return '<640'

  if (viewportWidth < 1024) return '640-1024'

  if (viewportWidth <= 1440) return '1024-1440'

  return '>1440'
}
