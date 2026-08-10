import { describe, expect, test } from 'bun:test'
import { RANKED_FRESHNESS_SECONDS, rankedFreshness } from '../ranked/model'

describe('ranked freshness', () => {
  test('uses last success with an inclusive one-hour freshness boundary', () => {
    const lastSuccess = new Date('2026-08-09T22:00:00Z')

    expect(RANKED_FRESHNESS_SECONDS).toBe(3600)
    expect(rankedFreshness(null, new Date('2026-08-09T22:30:00Z'))).toBe('unavailable')
    expect(rankedFreshness(lastSuccess, new Date('2026-08-09T23:00:00Z'))).toBe('fresh')
    expect(rankedFreshness(lastSuccess, new Date('2026-08-09T23:00:00.001Z'))).toBe('stale')
  })
})
