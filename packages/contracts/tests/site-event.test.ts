import { describe, expect, test } from 'bun:test'
import { siteEventInputSchema } from '../src'

const tab = { visitId: 'a'.repeat(32), path: '/' }
const found = { query: 'boomie', results: 3, aliasResults: 1, latencyMs: 180 }
const search = { ...tab, name: 'search.performed', source: 'bar', ...found }
const failed = { ...tab, name: 'search.failed', source: 'bar', latencyMs: 5_000 }
const selected = { ...tab, name: 'search.selected', source: 'bar', position: 2, viaAlias: true }

describe('site event', () => {
  test('takes a search, a failed search and a picked result', () => {
    for (const event of [search, failed, selected]) expect<unknown>(siteEventInputSchema.parse(event)).toEqual(event)
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
