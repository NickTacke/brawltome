import { describe, expect, it } from 'bun:test'
import { computeRefreshState } from '../../src/hooks/useStaleRefresh'

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
})
