import { describe, expect, test } from 'bun:test'
import { CAREER_FRESHNESS_SECONDS, careerFreshness } from '../career/model'

describe('career freshness', () => {
  test('uses last success with an inclusive twelve-hour freshness boundary', () => {
    const lastSuccess = new Date('2026-08-09T10:00:00Z')

    expect(CAREER_FRESHNESS_SECONDS).toBe(43_200)
    expect(careerFreshness(null, new Date('2026-08-09T11:00:00Z'))).toBe('unavailable')
    expect(careerFreshness(lastSuccess, new Date('2026-08-09T22:00:00Z'))).toBe('fresh')
    expect(careerFreshness(lastSuccess, new Date('2026-08-09T22:00:00.001Z'))).toBe('stale')
  })
})
