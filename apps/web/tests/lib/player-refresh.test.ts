import { describe, expect, test } from 'bun:test'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '../../src/lib/player-refresh'

describe('canonical player section polling', () => {
  test('uses independent canonical last-success timestamps and an inclusive twelve-hour career boundary', () => {
    const now = Date.parse('2026-08-10T10:00:00Z')
    const player = {
      currentSeason: { lastSuccessAt: '2026-08-10T09:00:00Z' },
      career: { lastSuccessAt: '2026-08-09T22:00:00Z' },
      statsLastUpdated: null,
    }

    expect(getPendingPlayerSections(player, now)).toEqual({ ranked: false, stats: false })
    expect(getPendingPlayerSections(player, now + 1)).toEqual({ ranked: true, stats: true })
  })

  test('always refreshes recent imported history and completes when canonical source replaces it', () => {
    const observedAt = '2026-08-10T10:00:00Z'
    const historical = {
      currentSeason: { lastSuccessAt: observedAt },
      career: { lastSuccessAt: observedAt, snapshotSource: 'legacy-v2' as const },
    }
    const canonical = {
      currentSeason: { lastSuccessAt: observedAt },
      career: { lastSuccessAt: observedAt, snapshotSource: 'v0-player-snapshot' as const },
    }

    expect(getPendingPlayerSections(historical, Date.parse(observedAt))).toEqual({ ranked: false, stats: true })
    expect(hasCompletedPlayerRefresh(historical, canonical, { ranked: false, stats: true })).toBe(true)
  })

  test('does not let one successful section satisfy polling for another pending section', () => {
    const initial = {
      currentSeason: { lastSuccessAt: '2026-08-10T09:00:00Z' },
      career: { lastSuccessAt: '2026-08-09T22:00:00Z' },
    }
    const rankedOnly = {
      currentSeason: { lastSuccessAt: '2026-08-10T10:00:00Z' },
      career: { lastSuccessAt: '2026-08-09T22:00:00Z' },
    }
    const both = {
      currentSeason: { lastSuccessAt: '2026-08-10T10:00:00Z' },
      career: { lastSuccessAt: '2026-08-10T10:00:00Z' },
    }

    expect(hasCompletedPlayerRefresh(initial, rankedOnly, { ranked: true, stats: true })).toBe(false)
    expect(hasCompletedPlayerRefresh(initial, both, { ranked: true, stats: true })).toBe(true)
  })
})
