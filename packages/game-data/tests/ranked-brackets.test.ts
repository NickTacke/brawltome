import { describe, expect, test } from 'bun:test'
import { currentOneVsOneBracket } from '..'

describe('current 1v1 rating brackets', () => {
  test('classifies the canonical Platinum and Diamond+ boundaries from rating', () => {
    expect(currentOneVsOneBracket(1679)).toBeNull()
    expect(currentOneVsOneBracket(1680)).toBe('Platinum')
    expect(currentOneVsOneBracket(1999)).toBe('Platinum')
    expect(currentOneVsOneBracket(2000)).toBe('Diamond+')
    expect(currentOneVsOneBracket(3000)).toBe('Diamond+')
  })
})
