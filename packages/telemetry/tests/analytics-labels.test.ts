import { describe, expect, test } from 'bun:test'
import { scrubError, scrubQuery } from '../src/analytics-labels'

describe('analytics scrubbers', () => {
  test('a query keeps its words, with one space between them and at most 64 characters', () => {
    expect(scrubQuery('  Boomie   the\tgreat  ')).toBe('Boomie the great')
    expect(scrubQuery('Boomie? 99')).toBe('Boomie? 99')
    expect(scrubQuery('x'.repeat(100))).toHaveLength(64)
  })

  test('an error loses its query string and anything past 200 characters', () => {
    const scrubbed = scrubError('fetch https://api.brawlhalla.com/player/1?api_key=SECRET123 failed token=abc')

    expect(scrubbed).not.toContain('SECRET123')
    expect(scrubbed).not.toContain('abc')
    expect(scrubError('e'.repeat(500))).toHaveLength(200)
  })

  test('both replace urls, secrets, emails, addresses and long ids', () => {
    for (const scrub of [scrubQuery, scrubError]) {
      expect(scrub('see https://x.y/p?a=1 ok')).toBe('see [url] ok')
      expect(scrub('password=hunter2')).toBe('[redacted]')
      expect(scrub('mail me@example.com now')).toBe('mail [email] now')
      expect(scrub('from 203.0.113.42 here')).toBe('from [ip] here')
      expect(scrub('from 2001:db8::1 here')).toBe('from [ip] here')
      expect(scrub('player 1234567 failed')).toBe('player [id] failed')
      expect(scrub('id 1234 ok')).toBe('id 1234 ok')
    }
  })
})
