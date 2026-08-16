import { describe, expect, it } from 'bun:test'
import { formatDate } from '../../src/lib/format'

describe('formatDate', () => {
  it('formats a Date in en-US by default', () => {
    expect(formatDate(new Date(Date.UTC(2026, 2, 15)))).toBe('3/15/2026')
  })

  it('formats a string date in en-US', () => {
    expect(formatDate('2026-03-15T00:00:00Z')).toBe('3/15/2026')
  })

  it('returns "-" for null', () => {
    expect(formatDate(null)).toBe('-')
  })
})
