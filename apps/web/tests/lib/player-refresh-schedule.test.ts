import { describe, expect, test } from 'bun:test'
import { resolvePollDelay } from '../../src/hooks/useStaleRefresh'
import {
  PLAYER_REFRESH_FALLBACK_POLL_MS,
  PLAYER_REFRESH_MAX_WAIT_MS,
  PLAYER_REFRESH_PUSHED_POLL_MS,
} from '../../src/lib/player-refresh'

describe('player refresh polling schedule', () => {
  test('polls every five seconds when the completion stream is unavailable', () => {
    expect(PLAYER_REFRESH_FALLBACK_POLL_MS).toBe(5_000)
  })

  test('keeps only a slow safety net while the completion stream is live', () => {
    expect(PLAYER_REFRESH_PUSHED_POLL_MS).toBe(15_000)
  })

  test('waits up to ninety seconds before giving up', () => {
    expect(PLAYER_REFRESH_MAX_WAIT_MS).toBe(90_000)
  })
})

describe('resolvePollDelay', () => {
  test('uses a fixed delay when given a number', () => {
    expect(resolvePollDelay(2_000, 50_000)).toBe(2_000)
  })

  test('uses the schedule for the elapsed time when given a function', () => {
    const schedule = (elapsed: number) => (elapsed < 10_000 ? 1_000 : 4_000)
    expect(resolvePollDelay(schedule, 0)).toBe(1_000)
    expect(resolvePollDelay(schedule, 10_000)).toBe(4_000)
  })
})
