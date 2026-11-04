import { describe, expect, test } from 'bun:test'
import { parseBoundedInteger, parsePositiveInteger, requirePositiveInteger } from '../validation'

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

describe('parseBoundedInteger', () => {
  const options = { name: 'DEEP_CRAWL_PAGE_DELAY_MS', fallback: 150, minimum: 0, maximum: 5_000 }

  test('uses the fallback when the text is missing', () => {
    expect(parseBoundedInteger(undefined, options)).toBe(150)
  })

  test('parses the text', () => {
    expect(parseBoundedInteger('250', options)).toBe(250)
  })

  test.each(['0', '5000'])('accepts the bound %p itself', (text) => {
    expect(parseBoundedInteger(text, options)).toBe(Number(text))
  })

  test.each(['-1', '5001', '1.5', 'abc', '', ' '])('rejects %p', (text) => {
    expect(() => parseBoundedInteger(text, options)).toThrow(
      `DEEP_CRAWL_PAGE_DELAY_MS must be an integer between 0 and 5000, got ${text}`,
    )
  })

  test('checks the fallback against the bounds too', () => {
    expect(() => parseBoundedInteger(undefined, { ...options, fallback: 6_000 })).toThrow(
      'DEEP_CRAWL_PAGE_DELAY_MS must be an integer between 0 and 5000, got 6000',
    )
  })
})
