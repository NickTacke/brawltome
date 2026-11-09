import { describe, expect, test } from 'bun:test'
import { pageRange, parsePageInput, previousPage } from '../src/components/Pager'

describe('pageRange', () => {
  test('covers a full first page', () => {
    expect(pageRange(1, 30, 197)).toEqual({ first: 1, last: 30 })
  })

  test('stops at the total on a partial last page', () => {
    expect(pageRange(7, 30, 197)).toEqual({ first: 181, last: 197 })
  })

  test('is empty when there are no rows', () => {
    expect(pageRange(1, 30, 0)).toEqual({ first: 0, last: 0 })
  })

  test('is empty for a page past the end or below the first', () => {
    expect(pageRange(99, 30, 197)).toEqual({ first: 0, last: 0 })
    expect(pageRange(0, 30, 197)).toEqual({ first: 0, last: 0 })
  })
})

describe('parsePageInput', () => {
  test('reads a page inside the range', () => {
    expect(parsePageInput('3', 7)).toBe(3)
  })

  test('accepts the first and last page', () => {
    expect(parsePageInput('1', 7)).toBe(1)
    expect(parsePageInput('7', 7)).toBe(7)
  })

  test('ignores pages outside the range instead of clamping them', () => {
    expect(parsePageInput('0', 7)).toBeNull()
    expect(parsePageInput('8', 7)).toBeNull()
    expect(parsePageInput('-2', 7)).toBeNull()
  })

  test('ignores text with no leading number', () => {
    expect(parsePageInput('', 7)).toBeNull()
    expect(parsePageInput('abc', 7)).toBeNull()
  })

  test('reads the leading whole number', () => {
    expect(parsePageInput(' 4 ', 7)).toBe(4)
    expect(parsePageInput('2.5', 7)).toBe(2)
    expect(parsePageInput('3x', 7)).toBe(3)
  })
})

describe('previousPage', () => {
  test('steps back one page', () => {
    expect(previousPage(4, 7)).toBe(3)
  })

  test('comes back to the last page from past the end', () => {
    expect(previousPage(99, 7)).toBe(7)
  })
})
