import { describe, expect, test } from 'bun:test'
import { TICK_HZ, TICK_MS, msToTick, tickToMs } from '../src/tick'

describe('tick conversions', () => {
  test('TICK_HZ is 60 and TICK_MS is the reciprocal', () => {
    expect(TICK_HZ).toBe(60)
    expect(TICK_MS).toBeCloseTo(1000 / 60, 5)
  })

  test('round-trip ms -> tick -> ms within half a tick', () => {
    const half = TICK_MS / 2
    for (const ms of [0, 16, 33, 100, 1000, 177872]) {
      const back = tickToMs(msToTick(ms))
      expect(Math.abs(back - ms)).toBeLessThanOrEqual(half + 1e-6)
    }
  })
})
