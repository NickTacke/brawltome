import { describe, expect, it } from 'bun:test'
import { isStale } from '../../src/lib/staleness'

describe('isStale', () => {
  it('returns true when lastUpdated is null', () => {
    expect(isStale(null, Date.UTC(2026, 0, 1), 60_000)).toBe(true)
  })

  it('returns true when now - lastUpdated > ttl', () => {
    const date = new Date(Date.UTC(2026, 0, 1))
    const now = date.getTime() + 60_001
    expect(isStale(date, now, 60_000)).toBe(true)
  })

  it('returns false when now - lastUpdated equals ttl', () => {
    const date = new Date(Date.UTC(2026, 0, 1))
    const now = date.getTime() + 60_000
    expect(isStale(date, now, 60_000)).toBe(false)
  })

  it('returns false when now - lastUpdated is less than ttl', () => {
    const date = new Date(Date.UTC(2026, 0, 1))
    const now = date.getTime() + 30_000
    expect(isStale(date, now, 60_000)).toBe(false)
  })

  it('returns false when lastUpdated is in the future', () => {
    const future = new Date(Date.UTC(2026, 0, 1))
    const now = future.getTime() - 60_000
    expect(isStale(future, now, 60_000)).toBe(false)
  })
})
