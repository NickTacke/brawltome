import { describe, expect, test } from 'bun:test'
import { siteEventInputSchema } from '../src'

const tab = { visitId: 'a'.repeat(32), path: '/' }
const found = { query: 'boomie', results: 3, aliasResults: 1, latencyMs: 180 }
const search = { ...tab, name: 'search.performed', source: 'bar', ...found }
const failed = { ...tab, name: 'search.failed', source: 'bar', latencyMs: 5_000 }
const selected = { ...tab, name: 'search.selected', source: 'bar', position: 2, viaAlias: true }
const vital = { ...tab, name: 'vitals', metric: 'LCP', value: 1834.5, viewportWidth: 390 }

describe('site event', () => {
  test('takes a search, a failed search and a picked result', () => {
    for (const event of [search, failed, selected]) expect<unknown>(siteEventInputSchema.parse(event)).toEqual(event)
  })

  test('takes each web vital the dashboards show, with a value that need not be whole', () => {
    for (const metric of ['LCP', 'INP', 'CLS', 'TTFB']) {
      const event = { ...vital, metric, value: 0.08 }

      expect<unknown>(siteEventInputSchema.parse(event)).toEqual(event)
    }
  })

  test('refuses a web vital that names a device, an unknown metric or a value out of range', () => {
    for (const event of [
      { ...vital, device: 'desktop' },
      { ...vital, metric: 'FCP' },
      { ...vital, value: -1 },
      { ...vital, value: 600_001 },
      { ...vital, value: Number.POSITIVE_INFINITY },
      { ...vital, value: '1834' },
      { ...vital, viewportWidth: 390.5 },
      { ...vital, viewportWidth: 20_001 },
      { ...tab, name: 'vitals', metric: 'LCP', value: 1834.5 },
    ]) {
      expect(siteEventInputSchema.safeParse(event).success).toBe(false)
    }
  })

  test('refuses an event it does not know', () => {
    expect(siteEventInputSchema.safeParse({ ...tab, name: 'search.typed', source: 'bar' }).success).toBe(false)
  })

  test('refuses anything that could carry more than a count or a label', () => {
    for (const event of [
      { ...search, visitId: 'not-hex' },
      { ...search, path: 'https://evil.test/' },
      { ...search, source: 'somewhere' },
      { ...search, query: 'q'.repeat(101) },
      { ...search, results: 101 },
      { ...search, aliasResults: -1 },
      { ...search, latencyMs: 600_001 },
      { ...search, latencyMs: 1.5 },
      { ...search, ip: '203.0.113.9' },
      { ...failed, query: 'boomie' },
      { ...selected, position: 101 },
      { ...selected, viaAlias: 'yes' },
    ]) {
      expect(siteEventInputSchema.safeParse(event).success).toBe(false)
    }
  })
})
