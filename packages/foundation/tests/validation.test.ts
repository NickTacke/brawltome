import { describe, expect, test } from 'bun:test'
import { parsePositiveInteger, requirePositiveInteger } from '../validation'

describe('requirePositiveInteger', () => {
  test('returns a positive integer unchanged', () => {
    expect(requirePositiveInteger(3, 'limit')).toBe(3)
  })

  test.each([0, -1, 1.5, Number.NaN])('rejects %p', (value) => {
    expect(() => requirePositiveInteger(value, 'limit')).toThrow(`limit must be a positive integer, got ${value}`)
  })
})

describe('parsePositiveInteger', () => {
  const options = { name: 'WORKER_CONCURRENCY', fallback: 4 }

  test('uses the fallback when the text is missing', () => {
    expect(parsePositiveInteger(undefined, options)).toBe(4)
  })

  test('parses the text', () => {
    expect(parsePositiveInteger('8', options)).toBe(8)
  })

  test.each(['abc', '0', '-2', '1.5', ''])('rejects %p', (text) => {
    expect(() => parsePositiveInteger(text, options)).toThrow(
      `WORKER_CONCURRENCY must be a positive integer, got ${text}`,
    )
  })

  test('rejects a value above the maximum', () => {
    expect(() => parsePositiveInteger('11', { ...options, maximum: 10 })).toThrow(
      'WORKER_CONCURRENCY must be at most 10',
    )
  })

  test('accepts the maximum itself', () => {
    expect(parsePositiveInteger('10', { ...options, maximum: 10 })).toBe(10)
  })

  test('checks the fallback against the maximum too', () => {
    expect(() => parsePositiveInteger(undefined, { ...options, maximum: 2 })).toThrow(
      'WORKER_CONCURRENCY must be at most 2',
    )
  })
})
