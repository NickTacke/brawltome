import { describe, expect, test } from 'bun:test'
import { referrerDomain, track } from '../../../src/lib/analytics/browser'

describe('referrerDomain', () => {
  test('keeps only external hosts', () => {
    expect(referrerDomain('https://www.google.com/search?q=x', 'brawltome.app')).toBe('google.com')
    expect(referrerDomain('https://brawltome.app/player/1', 'brawltome.app')).toBeUndefined()
    expect(referrerDomain('', 'brawltome.app')).toBe('direct')
  })
})

describe('track', () => {
  test('is a no-op without a window', () => {
    expect(() => track({ name: 'pageview' })).not.toThrow()
  })
})
