import { describe, expect, test } from 'bun:test'
import { resolvePollDelay } from '../../src/hooks/useStaleRefresh'
import { PLAYER_REFRESH_MAX_WAIT_MS, playerRefreshPollDelayMs } from '../../src/lib/player-refresh'

describe('player refresh polling schedule', () => {
  test('polls every two seconds for the first twenty seconds', () => {
    expect(playerRefreshPollDelayMs(0)).toBe(2_000)
    expect(playerRefreshPollDelayMs(19_999)).toBe(2_000)
  })

  test('backs off to five seconds once the worker is retrying', () => {
    expect(playerRefreshPollDelayMs(20_000)).toBe(5_000)
    expect(playerRefreshPollDelayMs(85_000)).toBe(5_000)
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
