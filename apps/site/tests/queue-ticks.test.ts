import { describe, expect, test } from 'bun:test'
import { maxTicks, tickCounts } from '../src/components/queue/queue-ticks'

describe('tickCounts', () => {
  test('draws one tick per game up to the cap', () => {
    expect(tickCounts(7, 3)).toEqual({ winTicks: 7, lossTicks: 3 })
    expect(tickCounts(10, 6)).toEqual({ winTicks: 10, lossTicks: 6 })
  })

  test('scales a longer session down to the cap, keeping the split', () => {
    expect(tickCounts(20, 12)).toEqual({ winTicks: 10, lossTicks: 6 })
    expect(tickCounts(30, 10)).toEqual({ winTicks: 12, lossTicks: 4 })
  })

  test('keeps one tick for a side that played, however lopsided', () => {
    expect(tickCounts(60, 1)).toEqual({ winTicks: maxTicks - 1, lossTicks: 1 })
    expect(tickCounts(1, 60)).toEqual({ winTicks: 1, lossTicks: maxTicks - 1 })
  })

  test('a side without games has no ticks', () => {
    expect(tickCounts(40, 0)).toEqual({ winTicks: maxTicks, lossTicks: 0 })
    expect(tickCounts(0, 2)).toEqual({ winTicks: 0, lossTicks: 2 })
  })
})
