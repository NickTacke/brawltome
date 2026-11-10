import { describe, expect, test } from 'bun:test'
import { pageCount, parsePage, rankWidthStyle } from '../src/components/page-number'

describe('parsePage', () => {
  test('keeps a page number from the address', () => {
    expect(parsePage(3, 500)).toBe(3)
    expect(parsePage('3', 500)).toBe(3)
  })

  // page 1 stays out of the address
  test.each([undefined, 1, 0, -2, 1.5, 'abc', '', null, true])('%p is the first page', (value) => {
    expect(parsePage(value, 500)).toBeUndefined()
  })

  test('a page past the last one the api serves is the last one', () => {
    expect(parsePage(9999, 500)).toBe(500)
  })
})

describe('pageCount', () => {
  test('counts a partial last page', () => {
    expect(pageCount(61, 30, 500)).toBe(3)
  })

  test('is zero without rows', () => {
    expect(pageCount(0, 30, 500)).toBe(0)
  })

  test('stops at the last page the api serves', () => {
    expect(pageCount(30_000, 30, 500)).toBe(500)
  })
})

describe('rankWidthStyle', () => {
  test.each([
    [5, 'w-12'],
    [999, 'w-12'],
    [1000, 'w-14'],
    [10_000, 'w-16'],
    [100_000, 'w-20'],
  ])('rank %p fits %p', (rank, style) => {
    expect(rankWidthStyle(rank)).toBe(style)
  })
})
