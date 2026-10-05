import { describe, expect, test } from 'bun:test'
import {
  analyticsBatchSchema,
  dataAgeBucket,
  deviceClass,
  routeTemplate,
  scrubError,
  scrubQuery,
  viewportBucket,
} from '../../../src/lib/analytics/schema'

describe('routeTemplate', () => {
  test('maps dynamic segments and unknown paths to fixed templates', () => {
    expect(routeTemplate('/')).toBe('/')
    expect(routeTemplate('/player/4281946')).toBe('/player/[id]')
    expect(routeTemplate('/clan/123/')).toBe('/clan/[id]')
    expect(routeTemplate('/stats/career-weapon-usage')).toBe('/stats/career-weapon-usage')
    expect(routeTemplate('/random/deep/path')).toBe('other')
    expect(routeTemplate('/player/4281946/extra')).toBe('other')
  })
  test('never echoes a raw bracketed template path', () => {
    expect(routeTemplate('/player/[id]')).toBe('other')
    expect(routeTemplate('/clan/[id]')).toBe('other')
  })
})

describe('buckets', () => {
  test('classifies device, viewport and data age', () => {
    expect(deviceClass(390)).toBe('mobile')
    expect(deviceClass(800)).toBe('tablet')
    expect(deviceClass(1440)).toBe('desktop')
    expect(viewportBucket(1500)).toBe('>1440')
    const now = Date.parse('2026-10-05T12:00:00Z')
    expect(dataAgeBucket(null, now)).toBe('never')
    expect(dataAgeBucket(new Date(now - 30 * 60_000), now)).toBe('lt_1h')
    expect(dataAgeBucket(new Date(now - 3 * 3_600_000), now)).toBe('1h_12h')
    expect(dataAgeBucket(new Date(now - 2 * 86_400_000), now)).toBe('12h_7d')
    expect(dataAgeBucket(new Date(now - 30 * 86_400_000), now)).toBe('gt_7d')
  })
})

describe('scrubbers', () => {
  test('trims and caps queries', () => {
    expect(scrubQuery('  Boomie   the\tgreat  ')).toBe('Boomie the great')
    expect(scrubQuery('x'.repeat(100))).toHaveLength(64)
  })
  test('removes urls and secrets from errors', () => {
    const scrubbed = scrubError('fetch https://api.brawlhalla.com/player/1?api_key=SECRET123 failed token=abc')
    expect(scrubbed).not.toContain('SECRET123')
    expect(scrubbed).not.toContain('https://')
    expect(scrubbed).not.toContain('abc')
    expect(scrubError('e'.repeat(500))).toHaveLength(200)
  })
  test('scrubQuery removes urls and secrets', () => {
    const scrubbed = scrubQuery('  token=abc https://x.y/p  ')
    expect(scrubbed).not.toContain('abc')
    expect(scrubbed).not.toContain('https://x.y')
    expect(scrubQuery('  hello   world ')).toBe('hello world')
  })
  test('redacts spaced and prefixed secrets', () => {
    for (const [input, secret] of [
      ['token: abc123', 'abc123'],
      ['Authorization Bearer xyz789', 'xyz789'],
      ['password=hunter2', 'hunter2'],
      ['api_key = k3y', 'k3y'],
      ['client secret: s3cr3t', 's3cr3t'],
    ] as const) {
      const scrubbed = scrubError(input)
      expect(scrubbed).not.toContain(secret)
      expect(scrubbed).toContain('[redacted]')
    }
  })
})

describe('analyticsBatchSchema', () => {
  const base = { tabId: 'a'.repeat(32), route: '/', device: 'desktop', viewport: '>1440', t: 5 }
  test('accepts known events', () => {
    const batch = analyticsBatchSchema.parse({
      events: [
        { ...base, name: 'pageview', referrerDomain: 'google.com' },
        {
          ...base,
          name: 'search.performed',
          source: 'bar',
          query: 'boomie',
          results: 0,
          aliasResults: 0,
          latencyMs: 120,
        },
        { ...base, name: 'feature.used', feature: 'pin' },
      ],
    })
    expect(batch.events).toHaveLength(3)
  })
  test('rejects unknown events, unknown features and oversized batches', () => {
    expect(() => analyticsBatchSchema.parse({ events: [{ ...base, name: 'evil' }] })).toThrow()
    expect(() => analyticsBatchSchema.parse({ events: [{ ...base, name: 'feature.used', feature: 'x' }] })).toThrow()
    expect(() =>
      analyticsBatchSchema.parse({ events: Array.from({ length: 61 }, () => ({ ...base, name: 'pageview' })) }),
    ).toThrow()
  })
})
