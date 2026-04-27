import { describe, expect, it } from 'bun:test'
import { buildQueryString, parseEnum, parseInteger } from '../../src/lib/searchParams'

describe('parseEnum', () => {
  const allowed = ['1v1', '2v2'] as const

  it('returns matched value', () => {
    expect(parseEnum('2v2', allowed, '1v1')).toBe('2v2')
  })

  it('returns fallback when raw is null', () => {
    expect(parseEnum(null, allowed, '1v1')).toBe('1v1')
  })

  it('returns fallback for unmatched value', () => {
    expect(parseEnum('3v3', allowed, '1v1')).toBe('1v1')
  })

  it('returns fallback for empty string', () => {
    expect(parseEnum('', allowed, '1v1')).toBe('1v1')
  })
})

describe('parseInteger', () => {
  it('returns parsed integer when valid', () => {
    expect(parseInteger('5', { default: 1 })).toBe(5)
  })

  it('returns default when null', () => {
    expect(parseInteger(null, { default: 1 })).toBe(1)
  })

  it('returns default when NaN', () => {
    expect(parseInteger('abc', { default: 1 })).toBe(1)
  })

  it('clamps to min', () => {
    expect(parseInteger('-3', { min: 1, default: 1 })).toBe(1)
  })

  it('clamps to max', () => {
    expect(parseInteger('9999', { max: 200, default: 1 })).toBe(200)
  })

  it('respects both min and max', () => {
    expect(parseInteger('150', { min: 1, max: 200, default: 1 })).toBe(150)
    expect(parseInteger('0', { min: 1, max: 200, default: 1 })).toBe(1)
    expect(parseInteger('500', { min: 1, max: 200, default: 1 })).toBe(200)
  })

  it('clamps default below min', () => {
    expect(parseInteger(null, { min: 1, default: -1 })).toBe(1)
  })

  it('clamps default above max', () => {
    expect(parseInteger(null, { max: 200, default: 9999 })).toBe(200)
  })
})

describe('buildQueryString', () => {
  it('encodes values', () => {
    expect(buildQueryString({ q: 'foo&bar', page: 2 })).toBe('q=foo%26bar&page=2')
  })

  it('omits undefined values', () => {
    expect(buildQueryString({ q: 'x', sort: undefined })).toBe('q=x')
  })

  it('returns empty string for empty input', () => {
    expect(buildQueryString({})).toBe('')
  })
})
