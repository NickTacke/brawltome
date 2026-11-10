import { siteVisitInputSchema } from './site-visit'
import { z } from './zod'

// every event names the tab and the page it happened on, the way a page view does
const { visitId, path, viewportWidth } = siteVisitInputSchema.shape
const tab = { visitId, path }

// the places the dashboards split searches by; the site only has the bar on the home page so far
const source = z.enum(['bar', 'palette'])
const latencyMs = z.number().int().min(0).max(600_000)
const resultCount = z.number().int().min(0).max(100)

const searchPerformed = z
  .object({
    ...tab,
    name: z.literal('search.performed'),
    source,
    // as typed, the api scrubs it before it is logged
    query: z.string().max(100),
    results: resultCount,
    // how many of the results matched on an old name
    aliasResults: resultCount,
    latencyMs,
  })
  .strict()

const searchFailed = z.object({ ...tab, name: z.literal('search.failed'), source, latencyMs }).strict()

const searchSelected = z
  .object({ ...tab, name: z.literal('search.selected'), source, position: resultCount, viaAlias: z.boolean() })
  .strict()

const webVital = z
  .object({
    ...tab,
    name: z.literal('vitals'),
    metric: z.enum(['LCP', 'INP', 'CLS', 'TTFB']),
    // milliseconds, except for CLS, which has no unit
    value: z.number().min(0).max(600_000),
    // the api works out the device from it, as it does for a page view
    viewportWidth,
  })
  .strict()

/**
 * One thing a visitor did, or that the site measured for them, counted beside page views. A new kind of event is one
 * more member here, the api adds who it was, as a daily key, from the request itself.
 */
export const siteEventInputSchema = z.discriminatedUnion('name', [
  searchPerformed,
  searchFailed,
  searchSelected,
  webVital,
])

export type SiteEventInputContract = z.infer<typeof siteEventInputSchema>
