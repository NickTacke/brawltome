import { describe, expect, it } from 'bun:test'
import { formatDate, formatPlaytime, formatWinrate } from '../../src/lib/format'

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

describe('formatPlaytime', () => {
  it('formats seconds to hours with one decimal', () => {
    expect(formatPlaytime(3600)).toBe('1.0h')
    expect(formatPlaytime(5400)).toBe('1.5h')
    expect(formatPlaytime(36000)).toBe('10.0h')
  })

  it('returns "-" for zero', () => {
    expect(formatPlaytime(0)).toBe('-')
  })

  it('returns "-" for negative', () => {
    expect(formatPlaytime(-1)).toBe('-')
  })
})

describe('formatWinrate', () => {
  it('formats winrate to one decimal percent', () => {
    expect(formatWinrate(50, 100)).toBe('50.0%')
    expect(formatWinrate(1, 3)).toBe('33.3%')
  })

  it('returns "-" when games is 0', () => {
    expect(formatWinrate(0, 0)).toBe('-')
  })

  it('returns "-" when games is negative', () => {
    expect(formatWinrate(0, -1)).toBe('-')
  })
})
