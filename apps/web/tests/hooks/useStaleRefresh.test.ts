import { describe, expect, it } from 'bun:test'
import { computeRefreshState } from '../../src/hooks/useStaleRefresh'
import { getPendingPlayerSections, hasCompletedPlayerRefresh } from '../../src/lib/player-refresh'

describe('computeRefreshState', () => {
  it('returns idle when not yet started', () => {
    expect(computeRefreshState({ startedAt: null, now: 1000, maxRefreshMs: 30_000 })).toEqual({
      isRefreshing: false,
    })
  })

  it('returns refreshing while within timeout window', () => {
    expect(computeRefreshState({ startedAt: 1000, now: 5000, maxRefreshMs: 30_000 })).toEqual({
      isRefreshing: true,
    })
  })

  it('returns idle when window exceeded', () => {
    expect(computeRefreshState({ startedAt: 1000, now: 32_000, maxRefreshMs: 30_000 })).toEqual({
      isRefreshing: false,
    })
  })

  it('returns refreshing exactly at window boundary', () => {
    expect(computeRefreshState({ startedAt: 1000, now: 31_000, maxRefreshMs: 30_000 })).toEqual({
      isRefreshing: true,
    })
  })

  it('returns refreshing for fresh start', () => {
    expect(computeRefreshState({ startedAt: 1000, now: 1000, maxRefreshMs: 30_000 })).toEqual({
      isRefreshing: true,
    })
  })
})

describe('player refresh sections', () => {
  it('starts a stats-only refresh when ranked data is still fresh', () => {
    const now = Date.UTC(2026, 0, 1, 12)
    const pending = getPendingPlayerSections(
      {
        currentSeason: { lastSuccessAt: new Date(now - 30 * 60_000) },
        career: { lastSuccessAt: new Date(now - 13 * 60 * 60_000) },
      },
      now,
    )

    expect(pending).toEqual({ ranked: false, stats: true })
  })

  it('does not finish a stats refresh when only ranked freshness advances', () => {
    const initial = {
      currentSeason: { lastSuccessAt: new Date(1_000) },
      career: { lastSuccessAt: new Date(1_000) },
    }
    const next = {
      currentSeason: { lastSuccessAt: new Date(2_000) },
      career: { lastSuccessAt: new Date(1_000) },
    }

    expect(hasCompletedPlayerRefresh(initial, next, { ranked: false, stats: true })).toBe(false)
  })

  it('requires every pending section to advance', () => {
    const initial = {
      currentSeason: { lastSuccessAt: new Date(1_000) },
      career: { lastSuccessAt: new Date(1_000) },
    }
    const pending = { ranked: true, stats: true }

    expect(
      hasCompletedPlayerRefresh(
        initial,
        { currentSeason: { lastSuccessAt: new Date(2_000) }, career: { lastSuccessAt: new Date(1_000) } },
        pending,
      ),
    ).toBe(false)
    expect(
      hasCompletedPlayerRefresh(
        initial,
        { currentSeason: { lastSuccessAt: new Date(2_000) }, career: { lastSuccessAt: new Date(2_000) } },
        pending,
      ),
    ).toBe(true)
  })

  it('requires authoritative ranked and stats timestamps for discovery', () => {
    const pending = getPendingPlayerSections(null, Date.UTC(2026, 0, 1))

    expect(
      hasCompletedPlayerRefresh(
        null,
        { currentSeason: { lastSuccessAt: new Date() }, career: { lastSuccessAt: null } },
        pending,
      ),
    ).toBe(false)
    expect(
      hasCompletedPlayerRefresh(
        null,
        { currentSeason: { lastSuccessAt: new Date() }, career: { lastSuccessAt: new Date() } },
        pending,
      ),
    ).toBe(true)
  })
})
