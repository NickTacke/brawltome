import { describe, expect, test } from 'bun:test'
import { replaceNul, replaceNulInJson } from '../db/storable-text'

describe('replaceNul', () => {
  test('replaces every NUL with the replacement character', () => {
    expect(replaceNul('a\u0000b\u0000')).toBe('a\uFFFDb\uFFFD')
  })

  test('leaves text without NUL unchanged', () => {
    expect(replaceNul('player name')).toBe('player name')
  })
})

describe('replaceNulInJson', () => {
  test('replaces NUL in keys and values at every depth', () => {
    const value: Record<string, unknown> = {
      'code\u0000': 'player\u0000 failed',
      details: { 'guild\u0000name': ['a\u0000', { nested: 'b\u0000c' }] },
    }

    expect(replaceNulInJson(value)).toEqual({
      'code\uFFFD': 'player\uFFFD failed',
      details: { 'guild\uFFFDname': ['a\uFFFD', { nested: 'b\uFFFDc' }] },
    })
  })

  test('keeps numbers, booleans and null as they are', () => {
    const value = { attempts: 3, retryable: false, cause: null }

    expect(replaceNulInJson(value)).toEqual(value)
  })

  test('replaces NUL in a bare string', () => {
    expect(replaceNulInJson('a\u0000')).toBe('a\uFFFD')
  })

  test('does not change the value it was given', () => {
    const value = { message: 'a\u0000' }

    replaceNulInJson(value)

    expect(value.message).toBe('a\u0000')
  })
})
