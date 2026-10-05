import { describe, expect, test } from 'bun:test'
import { getPlayerDataUpdatedAt } from '../../src/lib/player-refresh'

describe('getPlayerDataUpdatedAt', () => {
  test('uses the older of the ranked and career timestamps', () => {
    expect(
      getPlayerDataUpdatedAt({
        currentSeason: { lastSuccessAt: '2026-08-10T09:00:00Z' },
        career: { lastSuccessAt: new Date('2026-08-09T22:00:00Z') },
      }),
    ).toEqual(new Date('2026-08-09T22:00:00Z'))
  })

  test('falls back to whichever section has been fetched', () => {
    expect(
      getPlayerDataUpdatedAt({ currentSeason: { lastSuccessAt: '2026-08-10T09:00:00Z' }, career: null }),
    ).toEqual(new Date('2026-08-10T09:00:00Z'))
    expect(
      getPlayerDataUpdatedAt({ currentSeason: { lastSuccessAt: 'not-a-date' }, career: { lastSuccessAt: null } }),
    ).toBeNull()
  })

  test('returns null without a player', () => {
    expect(getPlayerDataUpdatedAt(null)).toBeNull()
  })
})
