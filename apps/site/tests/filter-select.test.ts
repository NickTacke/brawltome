import { describe, expect, test } from 'bun:test'
import { nextOptionIndex, viewportShiftPx } from '../src/components/FilterSelect'

describe('viewportShiftPx', () => {
  test('leaves a panel that already fits', () => {
    expect(viewportShiftPx(20, 200, 400)).toBe(0)
  })

  test('moves a panel off the start edge, keeping the margin', () => {
    expect(viewportShiftPx(-30, 100, 400)).toBe(38)
  })

  test('moves a panel off the end edge, keeping the margin', () => {
    expect(viewportShiftPx(300, 420, 400)).toBe(-28)
  })

  test('keeps the start edge visible when the panel is too big to fit', () => {
    expect(viewportShiftPx(20, 500, 400)).toBe(-12)
  })
})

describe('nextOptionIndex in a list', () => {
  test('steps down and up', () => {
    expect(nextOptionIndex('ArrowDown', 1, 4, 1)).toBe(2)
    expect(nextOptionIndex('ArrowUp', 1, 4, 1)).toBe(0)
  })

  test('wraps at both ends', () => {
    expect(nextOptionIndex('ArrowDown', 3, 4, 1)).toBe(0)
    expect(nextOptionIndex('ArrowUp', 0, 4, 1)).toBe(3)
  })

  test('jumps to the ends with home and end', () => {
    expect(nextOptionIndex('Home', 2, 4, 1)).toBe(0)
    expect(nextOptionIndex('End', 1, 4, 1)).toBe(3)
  })

  test('ignores sideways arrows and other keys', () => {
    expect(nextOptionIndex('ArrowLeft', 1, 4, 1)).toBeNull()
    expect(nextOptionIndex('ArrowRight', 1, 4, 1)).toBeNull()
    expect(nextOptionIndex('a', 1, 4, 1)).toBeNull()
  })
})

describe('nextOptionIndex in a grid', () => {
  test('moves sideways within the options', () => {
    expect(nextOptionIndex('ArrowRight', 4, 10, 5)).toBe(5)
    expect(nextOptionIndex('ArrowLeft', 5, 10, 5)).toBe(4)
  })

  test('moves between rows by the column count', () => {
    expect(nextOptionIndex('ArrowDown', 2, 10, 5)).toBe(7)
    expect(nextOptionIndex('ArrowUp', 7, 10, 5)).toBe(2)
  })

  test('wraps a column past the last row', () => {
    expect(nextOptionIndex('ArrowDown', 7, 10, 5)).toBe(2)
    expect(nextOptionIndex('ArrowUp', 2, 10, 5)).toBe(7)
  })
})
